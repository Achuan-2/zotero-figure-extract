import { OCRClient } from './ocr';
import { ExtractionService } from './extraction';
import { ReaderEntryManager } from './reader-entry';
import { labels, parsePageRange, type Result } from './domain';
import type { ExtractionAPI, RunOptions } from './contracts';
import { bindExtractionUI } from './ui';
import {
  host, PLUGIN_ID, getCredentials, saveCredentials, getProvider, setProvider, getSwitches, setSwitches,
  makeTransport, loadSidebarMarkup, readerDocument, liveReader, renderPage, cropRegion, sourceStamp, storeDirectory,
  readJSON, writeJSON, saveImage, saveFile, copyText, annotate, type Reader
} from './platform';

const client = new OCRClient(makeTransport(), getProvider, getCredentials);
const menus = new Map<Window, Element[]>();
const services = new Map<number, ExtractionService>();
const activeTasks = new Set<Promise<unknown>>();
const verificationControllers = new Set<AbortController>();
const readerEntries = new ReaderEntryManager(async (reader, doc) => {
  const api = await createAPI(reader);
  return bindExtractionUI(doc, api);
}, loadSidebarMarkup, showError);
let started = false;
let preferencesPaneID: string | undefined;

function showError(error: unknown): void {
  host.zotero.alert(host.mainWindow(), 'Zotero Figure Extract', error instanceof Error ? error.message : String(error));
}
function launch(reader?: Reader): void {
  void (async () => {
    reader ??= await selectedReader();
    await reader._initPromise;
    if (started) readerEntries.open(reader);
  })().catch(showError);
}

function onReaderReady({ reader, doc }: { reader: Reader; doc: Document }): void {
  // Observe reader readiness only; never append a toolbar button.
  readerEntries.attach(reader, doc);
}

async function attachExistingReader(reader: Reader): Promise<void> {
  if (reader.type !== 'pdf') return;
  try {
    await reader._initPromise;
    if (!started) return;
    const doc = reader._iframeWindow?.document as Document | undefined;
    if (doc) readerEntries.attach(reader, doc);
  } catch (error) {
    // A reader may be closed while its initialization is still pending.
    host.zotero.logError(error);
  }
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

async function createAPI(reader: Reader): Promise<ExtractionAPI> {
  await reader._initPromise;
  await reader._internalReader?._primaryView?.initializedPromise;
  const attachment = reader._item;
  const app = readerDocument(reader);
  const service = serviceFor(reader);
  const getReader = async (): Promise<Reader> => {
    if (!attachment) throw new Error('请先打开一个 PDF');
    return host.zotero.Reader.open(attachment.id);
  };
  const api: ExtractionAPI = {
    title: attachment?.attachmentFilename ?? 'OCR 接口设置',
    pageCount: app?.pdfDocument.numPages ?? 0,
    currentPage: app?.pdfViewer.currentPageNumber ?? 1,
    getSwitches, setSwitches, getCredentials, getProvider, setProvider,
    openExternal: url => host.zotero.launchURL(url),
    saveCredentials: async (value, provider) => { await saveCredentials(value, provider); client.clearToken(); },
    verify: async (provider, signal) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) controller.abort();
      verificationControllers.add(controller);
      const task = client.verify(provider, controller.signal);
      activeTasks.add(task);
      try { await task; } finally {
        activeTasks.delete(task); verificationControllers.delete(controller);
        signal.removeEventListener('abort', onAbort);
      }
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
      const content = format === 'json' ? JSON.stringify({ model: 'PaddleOCR-VL', attachmentKey: attachment?.key, results }, null, 2)
        : results.map(result => `## ${labels[result.kind]} · 第 ${result.pageIndex + 1} 页\n\n${result.caption ? result.caption + '\n\n' : ''}![${labels[result.kind]}](${result.image})\n\n${result.content}\n`).join('\n');
      return saveFile(`figure-extract.${format === 'json' ? 'json' : 'md'}`, content);
    },
    annotate: async result => { if (!attachment) throw new Error('没有 PDF 附件'); await annotate(attachment, result); },
    removeResult: id => service?.remove(id) ?? Promise.resolve()
  };
  return api;
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
      settings.addEventListener('command', () => host.zotero.Utilities.Internal.openPreferences(preferencesPaneID));
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
  host.zotero.Reader.registerEventListener('renderToolbar', onReaderReady, PLUGIN_ID);
  for (const reader of host.zotero.Reader._readers ?? []) void attachExistingReader(reader);
  for (const win of host.zotero.getMainWindows()) onMainWindowLoad(win);
}
export async function shutdown(): Promise<void> {
  started = false;
  if (preferencesPaneID) {
    host.zotero.PreferencePanes.unregister(preferencesPaneID);
    preferencesPaneID = undefined;
  }
  host.zotero.Reader.unregisterEventListener('renderToolbar', onReaderReady);
  readerEntries.clear();
  for (const service of services.values()) service.cancel();
  for (const controller of verificationControllers) controller.abort();
  await Promise.allSettled([...activeTasks]);
  for (const win of [...menus.keys()]) onMainWindowUnload(win);
  services.clear();
  client.clearToken();
}
