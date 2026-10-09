import { BaiduClient } from './baidu';
import { ExtractionService } from './extraction';
import { labels, parsePageRange, type Result } from './domain';
import type { DialogAPI, DialogArguments, RunOptions } from './contracts';
import {
  host, PLUGIN_ID, getCredentials, saveCredentials, getSwitches, setSwitches,
  makeTransport, readerDocument, liveReader, renderPage, cropRegion, sourceStamp, storeDirectory,
  readJSON, writeJSON, saveImage, saveFile, copyText, annotate, type Reader
} from './platform';

const client = new BaiduClient(makeTransport(), getCredentials);
const menus = new Map<Window, Element[]>();
const windows = new Map<number | 'settings', Window>();
const services = new Map<number, ExtractionService>();
const activeTasks = new Set<Promise<unknown>>();
const verificationControllers = new Set<AbortController>();
const toolbarButtons = new Set<Element>();
let started = false;
let preferencesPaneID: string | undefined;

function showError(error: unknown): void {
  host.zotero.alert(host.mainWindow(), 'Zotero Figure Extract', error instanceof Error ? error.message : String(error));
}
function launch(reader?: Reader, settingsOnly = false): void {
  void openDialog(reader, settingsOnly).catch(showError);
}

function onToolbar({ reader, doc, append }: { reader: Reader; doc: Document; append: (node: Element) => void }): void {
  if (reader.type !== 'pdf') return;
  const button = doc.createElement('button');
  button.className = 'toolbar-button figureextract-button';
  button.textContent = '图表公式';
  button.title = 'PaddleOCR-VL 1.6：提取图、表、公式';
  button.addEventListener('click', () => launch(reader));
  append(button);
  toolbarButtons.add(button);
}

async function selectedReader(): Promise<Reader> {
  const win = host.mainWindow();
  const selected = host.zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID) as Reader | undefined;
  if (selected?.type === 'pdf') return selected;
  const items = host.zotero.getActiveZoteroPane().getSelectedItems();
  if (items.length !== 1) throw new Error('请打开一个 PDF，或在文库中选择一个文献 / PDF 附件');
  let item = items[0];
  if (!item.isPDFAttachment?.()) {
    const ids = item.getAttachments?.() ?? [];
    item = ids.map((id: number) => host.zotero.Items.get(id)).find((attachment: any) => attachment.isPDFAttachment());
  }
  if (!item) throw new Error('所选条目没有 PDF 附件');
  const reader = await host.zotero.Reader.open(item.id) as Reader;
  await reader._initPromise;
  return reader;
}

function serviceFor(reader: Reader): ExtractionService {
  const attachment = reader._item;
  let service = services.get(attachment.id);
  if (service) return service;
  const directory = storeDirectory(attachment);
  service = new ExtractionService(client, {
    stamp: () => sourceStamp(attachment),
    read: name => readJSON(directory, name),
    write: (name, data) => writeJSON(directory, name, data),
    render: async (pageIndex, signal) => {
      // Retrieve the live Reader, since a tab may have been closed and reopened.
      const rendered = await renderPage(liveReader(attachment.id, reader), pageIndex, signal);
      return { base64: rendered.base64, dispose: rendered.dispose,
        crop: (region, width, height) => cropRegion(rendered, region, width, height) };
    }
  });
  services.set(attachment.id, service);
  return service;
}

async function openDialog(reader: Reader | undefined, settingsOnly: boolean): Promise<void> {
  if (!started) return;
  if (!settingsOnly) {
    reader ??= await selectedReader();
    await reader._initPromise;
    await reader._internalReader?._primaryView?.initializedPromise;
  }
  if (!started) return;
  const attachment = reader?._item;
  const key = settingsOnly ? 'settings' : attachment!.id;
  const previous = windows.get(key);
  if (previous && !previous.closed) { previous.focus(); return; }
  const app = reader ? readerDocument(reader) : undefined;
  const service = reader ? serviceFor(reader) : undefined;
  const getReader = async (): Promise<Reader> => {
    if (!attachment) throw new Error('请先打开一个 PDF');
    return host.zotero.Reader.open(attachment.id);
  };
  const api: DialogAPI = {
    title: attachment?.attachmentFilename ?? '百度 OCR 设置',
    pageCount: app?.pdfDocument.numPages ?? 0,
    currentPage: app?.pdfViewer.currentPageNumber ?? 1,
    getSwitches, setSwitches, getCredentials,
    saveCredentials: async value => { await saveCredentials(value); client.clearToken(); },
    verify: async () => {
      const controller = new AbortController();
      verificationControllers.add(controller);
      const task = client.verify(controller.signal);
      activeTasks.add(task);
      try { await task; } finally { activeTasks.delete(task); verificationControllers.delete(controller); }
    },
    load: () => service?.load() ?? Promise.resolve([]),
    run: async (options: RunOptions, progress, update) => {
      if (!service) throw new Error('请先打开一个 PDF');
      const liveReader = await getReader();
      await liveReader._initPromise;
      await liveReader._internalReader?._primaryView?.initializedPromise;
      const liveApp = readerDocument(liveReader);
      const pages = options.scope === 'all' ? Array.from({ length: liveApp.pdfDocument.numPages }, (_, i) => i)
        : options.scope === 'current' ? [liveApp.pdfViewer.currentPageNumber - 1]
        : parsePageRange(options.range, liveApp.pdfDocument.numPages);
      setSwitches(options.switches);
      const task = service.run(pages, options, progress, update);
      activeTasks.add(task);
      try { return await task; } finally { activeTasks.delete(task); }
    },
    cancel: () => service?.cancel(),
    openSource: async result => { const live = await getReader(); await live.navigate({ position: { pageIndex: result.pageIndex, rects: [result.pdfRect] } }); await (live as any).focus?.(); },
    copyText, saveImage,
    exportResults: async (results, format) => {
      const content = format === 'json' ? JSON.stringify({ model: 'PaddleOCR-VL 1.6 (Baidu API)', attachmentKey: attachment?.key, results }, null, 2)
        : results.map(result => `## ${labels[result.kind]} · 第 ${result.pageIndex + 1} 页\n\n${result.caption ? result.caption + '\n\n' : ''}![${labels[result.kind]}](${result.image})\n\n${result.content}\n`).join('\n');
      return saveFile(`figure-extract.${format === 'json' ? 'json' : 'md'}`, content);
    },
    annotate: async result => { if (!attachment) throw new Error('没有 PDF 附件'); await annotate(attachment, result); },
    removeResult: id => service?.remove(id) ?? Promise.resolve()
  };
  const args: DialogArguments = { api, settingsOnly };
  const win = host.mainWindow().openDialog('chrome://figureextract/content/dialog.xhtml', '',
    'chrome,centerscreen,resizable,dialog=no,width=1060,height=800', args);
  windows.set(key, win);
  win.addEventListener('unload', () => {
    service?.cancel();
    if (windows.get(key) === win) windows.delete(key);
  }, { once: true });
}

export function onMainWindowLoad(win: Window): void {
  if (!started || menus.has(win)) return;
  const nodes: Element[] = [];
  for (const parentID of ['menu_ToolsPopup', 'zotero-itemmenu']) {
    const parent = win.document.getElementById(parentID);
    if (!parent) continue;
    const item = win.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
    item.setAttribute('label', '图、表、公式提取（PaddleOCR-VL）');
    item.addEventListener('command', () => launch());
    parent.appendChild(item);
    nodes.push(item);
    if (parentID === 'menu_ToolsPopup') {
      const settings = win.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
      settings.setAttribute('label', 'Figure Extract 设置…');
      settings.addEventListener('command', () => launch(undefined, true));
      parent.appendChild(settings);
      nodes.push(settings);
    }
  }
  menus.set(win, nodes);
}
export function onMainWindowUnload(win: Window): void {
  for (const node of menus.get(win) ?? []) node.remove();
  menus.delete(win);
}
export async function startup(): Promise<void> {
  await host.wait();
  preferencesPaneID = await host.zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    id: 'figureextract-preferences',
    label: 'Figure Extract',
    image: 'chrome://figureextract/content/icons/icon-48.png',
    src: 'chrome://figureextract/content/preferences.xhtml',
    scripts: ['chrome://figureextract/content/preferences.js'],
    stylesheets: ['chrome://figureextract/content/preferences.css'],
    helpURL: 'https://github.com/Achuan-2/zotero-figure-extract'
  });
  started = true;
  host.zotero.Reader.registerEventListener('renderToolbar', onToolbar, PLUGIN_ID);
  for (const win of host.zotero.getMainWindows()) onMainWindowLoad(win);
}
export async function shutdown(): Promise<void> {
  started = false;
  if (preferencesPaneID) {
    host.zotero.PreferencePanes.unregister(preferencesPaneID);
    preferencesPaneID = undefined;
  }
  host.zotero.Reader.unregisterEventListener('renderToolbar', onToolbar);
  for (const service of services.values()) service.cancel();
  for (const controller of verificationControllers) controller.abort();
  for (const win of windows.values()) if (!win.closed) win.close();
  await Promise.allSettled([...activeTasks]);
  for (const win of [...menus.keys()]) onMainWindowUnload(win);
  for (const button of toolbarButtons) { try { button.remove(); } catch { /* Reader realm can already be gone. */ } }
  toolbarButtons.clear();
  services.clear();
  windows.clear();
  client.clearToken();
}
