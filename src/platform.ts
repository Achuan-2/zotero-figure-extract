/* All private Zotero/PDF.js compatibility access is confined to this adapter.
 * Core services and the UI consume explicit typed contracts. */
import { abortIfNeeded, type Rect, type Region, type Result, type Switches, defaults } from './domain';
import type { Credentials, Transport } from './baidu';

// Gecko and Zotero runtime objects are supplied by bootstrap.js, not Node.js.
declare const Zotero: any;
declare const Services: any;
declare const Components: any;
declare const ChromeUtils: any;
declare const IOUtils: any;
declare const PathUtils: any;

export const PLUGIN_ID = 'zotero-figure-extract@achuan';
const PREF_PREFIX = 'extensions.zotero.figureextract.';
const LOGIN_ORIGIN = 'chrome://figureextract';
const LOGIN_REALM = 'Baidu PaddleOCR-VL';

export interface Attachment {
  id: number;
  key: string;
  libraryID: number;
  parentItemID?: number;
  attachmentFilename: string;
  getFilePathAsync(): Promise<string | false>;
  getAnnotations(): any[];
}
export interface Reader {
  type: string;
  _item: Attachment;
  _internalReader: any;
  _iframeWindow: any;
  _initPromise: Promise<void>;
  navigate(location: { position: { pageIndex: number; rects?: Rect[] } }): Promise<void>;
}
export interface PdfViewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
}
export interface RenderedPage {
  canvas: HTMLCanvasElement;
  viewport: PdfViewport;
  base64: string;
  dispose(): void;
}

export const host = {
  zotero: Zotero,
  mainWindow: () => Zotero.getMainWindow() as Window & { openDialog: (...args: any[]) => Window; Zotero_Tabs: any; XMLHttpRequest: typeof XMLHttpRequest },
  wait: () => Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]),
};

export function getSwitches(): Switches {
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Zotero.Prefs.get(PREF_PREFIX + key, true) ?? value])) as Switches;
}
export function setSwitches(switches: Switches): void {
  for (const key of Object.keys(defaults) as (keyof Switches)[]) Zotero.Prefs.set(PREF_PREFIX + key, switches[key], true);
}

export function getCredentials(): Credentials {
  const login = Services.logins.findLogins(LOGIN_ORIGIN, null, LOGIN_REALM)[0];
  return login ? { apiKey: login.username, secretKey: login.password } : { apiKey: '', secretKey: '' };
}
export async function saveCredentials(value: Credentials): Promise<void> {
  const current = Services.logins.findLogins(LOGIN_ORIGIN, null, LOGIN_REALM)[0];
  if (!value.apiKey.trim() && !value.secretKey.trim()) {
    if (current) Services.logins.removeLogin(current);
    return;
  }
  if (!value.apiKey.trim() || !value.secretKey.trim()) throw new Error('API Key 和 Secret Key 都需要填写');
  const login = Components.classes['@mozilla.org/login-manager/loginInfo;1'].createInstance(Components.interfaces.nsILoginInfo);
  login.init(LOGIN_ORIGIN, null, LOGIN_REALM, value.apiKey.trim(), value.secretKey.trim(), '', '');
  if (current) Services.logins.modifyLogin(current, login);
  else await Services.logins.addLoginAsync(login);
}

export function makeTransport(): Transport {
  function request(method: 'GET' | 'POST', url: string, values: Record<string, string> | undefined, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      abortIfNeeded(signal);
      // Chrome-window XHR has the system principal. Using it directly also avoids
      // Zotero.HTTP logging access_token query parameters and signed BOS URLs.
      const xhr = new (host.mainWindow().XMLHttpRequest)();
      const onAbort = () => { xhr.abort(); };
      const finish = (error?: Error) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(new Error('操作已取消'));
        else if (error) reject(error);
        else resolve(xhr.response);
      };
      xhr.open(method, url, true);
      xhr.responseType = 'json';
      xhr.timeout = 120000;
      xhr.onload = () => finish(xhr.status < 200 || xhr.status >= 300 || !xhr.response || typeof xhr.response !== 'object'
        ? new Error(`百度请求失败（HTTP ${xhr.status}），请检查服务权限与网络`) : undefined);
      xhr.onerror = () => finish(new Error('百度请求失败，请检查网络后重试'));
      xhr.ontimeout = () => finish(new Error('百度请求超时，请稍后重试'));
      xhr.onabort = () => finish(new Error('操作已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (values) xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      const body = values ? Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&') : null;
      try { xhr.send(body); if (signal.aborted) onAbort(); }
      catch { finish(new Error('无法发送百度请求，请检查网络')); }
    });
  }
  return {
    post: (url, values, signal) => request('POST', url, values, signal),
    get: (url, signal) => request('GET', url, undefined, signal),
    delay: (ms, signal) => new Promise((resolve, reject) => {
      abortIfNeeded(signal);
      const win = host.mainWindow();
      const onAbort = () => { win.clearTimeout(timer); reject(new Error('操作已取消')); };
      const timer = win.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    })
  };
}

export function readerDocument(reader: Reader): any {
  const view = reader._internalReader?._primaryView;
  const frame = view?._iframeWindow;
  const app = (frame?.wrappedJSObject ?? frame)?.PDFViewerApplication;
  if (!app?.pdfDocument) throw new Error('PDF 阅读器尚未准备好，请等待加载后重试');
  return app;
}

export function liveReader(attachmentID: number, fallback: Reader): Reader {
  return Zotero.Reader._readers.find((reader: Reader) => reader._item?.id === attachmentID) ?? fallback;
}

export async function renderPage(reader: Reader, pageIndex: number, signal: AbortSignal): Promise<RenderedPage> {
  abortIfNeeded(signal);
  const page = await readerDocument(reader).pdfDocument.getPage(pageIndex + 1);
  const frame = reader._internalReader._primaryView._iframeWindow;
  const realm = frame.wrappedJSObject ?? frame;
  const original = page.getViewport(Components.utils.cloneInto({ scale: 1 }, realm));
  const scale = Math.min(3, 2400 / Math.max(original.width, original.height), Math.sqrt(4_000_000 / (original.width * original.height)));
  // PDF.js options/canvas must belong to the Reader realm across Xray wrappers.
  const doc = frame.document as Document;
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  const viewport = page.getViewport(Components.utils.cloneInto({ scale }, realm));
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 PDF 页面画布');
  const renderOptions = new realm.Object();
  renderOptions.canvasContext = context;
  renderOptions.viewport = viewport;
  renderOptions.background = 'rgb(255,255,255)';
  const task = page.render(renderOptions);
  const onAbort = () => task.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) task.cancel();
    await task.promise;
    abortIfNeeded(signal);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    if (base64.length * 0.75 > 10 * 1024 * 1024) throw new Error('页面 PNG 超过百度 10 MB 限制');
    return { canvas, viewport, base64, dispose: () => { canvas.width = canvas.height = 0; } };
  } catch (error) {
    canvas.width = canvas.height = 0;
    abortIfNeeded(signal);
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function cropRegion(rendered: RenderedPage, region: Region, sourceWidth: number, sourceHeight: number): Result {
  const { canvas, viewport } = rendered;
  if (Math.abs((sourceWidth / sourceHeight) / (canvas.width / canvas.height) - 1) > 0.02) {
    throw new Error('百度返回的页面比例与原文不一致，无法可靠裁图');
  }
  const x1 = region.box[0] / sourceWidth * canvas.width, y1 = region.box[1] / sourceHeight * canvas.height;
  const x2 = region.box[2] / sourceWidth * canvas.width, y2 = region.box[3] / sourceHeight * canvas.height;
  const crop = canvas.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  crop.width = Math.max(1, Math.ceil(x2 - x1));
  crop.height = Math.max(1, Math.ceil(y2 - y1));
  const context = crop.getContext('2d');
  if (!context) throw new Error('无法创建裁图画布');
  try {
    context.drawImage(canvas, x1, y1, x2 - x1, y2 - y1, 0, 0, crop.width, crop.height);
    const points = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].map(([x, y]) =>
      viewport.convertToPdfPoint(Math.min(viewport.width, x), Math.min(viewport.height, y)));
    const pdfRect: Rect = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
    return { ...region, pdfRect, image: crop.toDataURL('image/png') };
  } finally { crop.width = crop.height = 0; }
}

export async function sourceStamp(attachment: Attachment): Promise<string> {
  const path = await attachment.getFilePathAsync();
  if (!path) throw new Error('PDF 文件不存在，请先下载附件');
  const stat = await IOUtils.stat(path);
  return `${path}:${stat.size}:${stat.lastModified}`;
}
export function storeDirectory(attachment: Attachment): string {
  return PathUtils.join(Zotero.DataDirectory.dir, 'zotero-figure-extract', String(attachment.libraryID), attachment.key);
}
export async function readJSON<T>(directory: string, name: string): Promise<T | undefined> {
  const path = PathUtils.join(directory, name);
  if (!(await IOUtils.exists(path))) return undefined;
  try { return await IOUtils.readJSON(path) as T; }
  catch { throw new Error(`本地结果文件损坏：${name}；请备份后移除此文件并重试`); }
}
export async function writeJSON(directory: string, name: string, data: unknown): Promise<void> {
  await IOUtils.makeDirectory(directory, { ignoreExisting: true, createAncestors: true });
  const path = PathUtils.join(directory, name);
  await IOUtils.writeJSON(path, data, { tmpPath: path + '.tmp' });
}

export function copyText(text: string): void {
  Components.classes['@mozilla.org/widget/clipboardhelper;1'].getService(Components.interfaces.nsIClipboardHelper).copyString(text);
}
export async function saveFile(name: string, content: Uint8Array | string): Promise<boolean> {
  const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const picker = new FilePicker();
  picker.init(host.mainWindow(), '保存提取结果', picker.modeSave);
  picker.defaultString = name;
  const extension = name.split('.').pop() ?? '';
  picker.appendFilter(extension.toUpperCase(), `*.${extension}`);
  const selected = await picker.show();
  if (selected !== picker.returnOK && selected !== picker.returnReplace) return false;
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  await IOUtils.write(picker.file, bytes, { tmpPath: picker.file + '.tmp' });
  return true;
}
export async function saveImage(result: Result): Promise<boolean> {
  const binary = host.mainWindow().atob(result.image.split(',')[1]);
  return saveFile(`${result.kind}-p${result.pageIndex + 1}-${result.id.replace(/[^\w-]/g, '_')}.png`, Uint8Array.from(binary, c => c.charCodeAt(0)));
}

export async function annotate(attachment: Attachment, result: Result): Promise<void> {
  if (Zotero.Libraries.get(attachment.libraryID)?.editable === false) throw new Error('当前文库只读，无法添加标注');
  const tag = { figure: 'Figure', table: 'Table', formula: 'Formula' }[result.kind];
  const existing = attachment.getAnnotations().some(item => item.annotationAuthorName === 'figureextract'
    && item.annotationPosition === JSON.stringify({ pageIndex: result.pageIndex, rects: [result.pdfRect] }));
  if (existing) return;
  const key = Zotero.Utilities.generateObjectKey();
  const date = new Date().toISOString();
  const item = await Zotero.Annotations.saveFromJSON(attachment, {
    id: key, key, type: 'image', authorName: 'figureextract', color: '#a8c6f7',
    comment: [result.caption, result.content].filter(Boolean).join('\n\n'), text: '',
    pageLabel: String(result.pageIndex + 1),
    sortIndex: `${String(result.pageIndex).padStart(5, '0')}|000000|00000`,
    position: { pageIndex: result.pageIndex, rects: [result.pdfRect] }, dateCreated: date, dateModified: date
  });
  item.setTags([tag, 'PaddleOCR-VL']);
  await item.saveTx();
}
