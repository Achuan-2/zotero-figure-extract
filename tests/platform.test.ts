import test from 'node:test';
import assert from 'node:assert/strict';
import type { Region } from '../src/domain';
import type { RenderedPage } from '../src/platform';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

Object.assign(globalThis, { Zotero: {}, Services: {}, Components: {}, IOUtils: {}, PathUtils: {} });

test('侧栏模板嵌入样式，通过 srcdoc 加载且不引用受限的 chrome 页面或脚本', async () => {
  const { loadSidebarMarkup } = await import('../src/platform');
  const realm = new JSDOM();
  const urls: string[] = [];
  Object.assign((globalThis as any).Zotero, {
    getMainWindow: () => ({ DOMParser: realm.window.DOMParser }),
    File: { getContentsFromURLAsync: async (url: string) => {
      urls.push(url);
      return readFile(url.endsWith('sidebar.xhtml') ? 'addon/chrome/content/sidebar.xhtml' : 'addon/chrome/content/style.css', 'utf8');
    } }
  });
  const content = new JSDOM(await loadSidebarMarkup());
  assert.equal(urls.length, 2);
  assert.ok(content.window.document.querySelector('style')?.textContent?.includes('.type-switches'));
  assert.equal(content.window.document.querySelector('script, link[href^="chrome:"]'), null);
  assert.ok(content.window.document.getElementById('start'));
  content.window.close();
  realm.window.close();
});

test('登录管理器保持旧百度凭据，独立保存 AI Studio 单 Key；清空单 Key 不删除百度凭据', async () => {
  const { getCredentials, saveCredentials, getProvider, setProvider } = await import('../src/platform');
  const prefs = new Map<string, unknown>();
  const logins = [{ realm: 'Baidu PaddleOCR-VL', username: 'legacy-key', password: 'legacy-secret' }];
  Object.assign((globalThis as any).Zotero, { Prefs: {
    get: (name: string) => prefs.get(name), set: (name: string, value: unknown) => prefs.set(name, value)
  } });
  Object.assign((globalThis as any).Services, { logins: {
    findLogins: (_origin: string, _form: unknown, realm: string) => logins.filter(login => login.realm === realm),
    addLoginAsync: async (login: typeof logins[number]) => { logins.push(login); },
    modifyLogin: (before: typeof logins[number], after: typeof logins[number]) => { Object.assign(before, after); },
    removeLogin: (login: typeof logins[number]) => { logins.splice(logins.indexOf(login), 1); }
  } });
  Object.assign((globalThis as any).Components, { classes: { '@mozilla.org/login-manager/loginInfo;1': {
    createInstance: () => ({ init(_origin: string, _form: unknown, realm: string, username: string, password: string) {
      Object.assign(this, { realm, username, password });
    } })
  } }, interfaces: { nsILoginInfo: {} } });
  assert.equal(getProvider(), 'aistudio');
  assert.deepEqual(getCredentials(), { apiKey: '', secretKey: '' });
  setProvider('baidu');
  assert.equal(getProvider(), 'baidu');
  assert.deepEqual(getCredentials(), { apiKey: 'legacy-key', secretKey: 'legacy-secret' });
  await saveCredentials({ apiKey: 'studio-key', secretKey: '' }, 'aistudio');
  setProvider('aistudio');
  assert.deepEqual(getCredentials(), { apiKey: 'studio-key', secretKey: '' });
  assert.equal(logins[1].password, 'studio-key');
  assert.equal(logins[1].username, 'access-token');
  await saveCredentials({ apiKey: '', secretKey: '' }, 'aistudio');
  assert.deepEqual(getCredentials('baidu'), { apiKey: 'legacy-key', secretKey: 'legacy-secret' });
  await assert.rejects(saveCredentials({ apiKey: 'incomplete-cloud', secretKey: '' }, 'baidu'), /都需要/);
});

test('AI Studio 传输保留真实 PNG 字节和 multipart 边界，支持 Bearer 和 JSONL 文本', async () => {
  const { makeTransport } = await import('../src/platform');
  const calls: FakeXHR[] = [];
  class FakeXHR {
    headers: Record<string, string> = {};
    responseType = '';
    response: unknown = { code: 0 };
    status = 200;
    body?: FormData | null;
    onload?: () => void;
    onabort?: () => void;
    constructor() { calls.push(this); }
    open() {}
    setRequestHeader(key: string, value: string) { this.headers[key] = value; }
    send(body: FormData | null) { this.body = body; }
    abort() { this.onabort?.(); }
  }
  Object.assign((globalThis as any).Zotero, { getMainWindow: () => ({ XMLHttpRequest: FakeXHR, Blob, FormData, atob }) });
  const transport = makeTransport();
  const upload = transport.request({ method: 'POST', url: 'https://api.example.test', response: 'json',
    headers: { Authorization: 'Bearer test-token' },
    body: { fields: { model: 'PaddleOCR-VL-1.6' }, file: { base64: 'AAH/', name: 'page.png', type: 'image/png' } }
  }, new AbortController().signal);
  assert.equal(calls[0].headers['Content-Type'], undefined);
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].body?.get('model'), 'PaddleOCR-VL-1.6');
  const file = calls[0].body?.get('file') as File;
  assert.equal(file.name, 'page.png');
  assert.equal(file.type, 'image/png');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([0, 1, 255]));
  calls[0].onload!();
  await upload;
  const download = transport.request({ method: 'GET', url: 'https://result.example.test', response: 'text' }, new AbortController().signal);
  assert.equal(calls[1].responseType, 'text');
  assert.deepEqual(calls[1].headers, {});
  calls[1].response = '{"result":{}}\n';
  calls[1].onload!();
  assert.equal(await download, '{"result":{}}\n');
  const controller = new AbortController();
  const cancelled = transport.request({ method: 'GET', url: 'https://api.example.test', response: 'json' }, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /取消/);
});

test('裁图按 API 页面比例映射，在四种 PDF 旋转下都生成正确的原文矩形', async () => {
  const { cropRegion } = await import('../src/platform');
  const cases = [
    { width: 600, height: 800, transform: (x: number, y: number) => [x / 4, 800 - y / 4], expected: [60, 400, 300, 720] },
    { width: 800, height: 600, transform: (x: number, y: number) => [y / 4, x / 4], expected: [60, 80, 300, 400] },
    { width: 600, height: 800, transform: (x: number, y: number) => [600 - x / 4, y / 4], expected: [300, 80, 540, 400] },
    { width: 800, height: 600, transform: (x: number, y: number) => [600 - y / 4, 800 - x / 4], expected: [300, 400, 540, 720] }
  ];
  for (const c of cases) {
    const crop = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/png;base64,AA==' };
    const rendered = {
      canvas: { width: c.width * 4, height: c.height * 4, ownerDocument: { createElementNS: () => crop } },
      viewport: { width: c.width * 4, height: c.height * 4, convertToPdfPoint: c.transform },
      base64: '', dispose() {}
    } as unknown as RenderedPage;
    const region: Region = { id: 'x', kind: 'figure', pageIndex: 0, box: [c.width * .1, c.height * .1, c.width * .5, c.height * .5], content: '', caption: '' };
    const result = cropRegion(rendered, region, c.width, c.height);
    assert.deepEqual(result.pdfRect, c.expected);
    assert.equal(crop.width, 0);
    assert.equal(crop.height, 0);
  }
});

test('比例不一致时拒绝裁图，避免错位结果', async () => {
  const { cropRegion } = await import('../src/platform');
  const rendered = { canvas: { width: 600, height: 800 }, viewport: {} } as unknown as RenderedPage;
  const region: Region = { id: 'x', kind: 'figure', pageIndex: 0, box: [0, 0, 10, 10], content: '', caption: '' };
  assert.throws(() => cropRegion(rendered, region, 800, 600), /比例/);
});

test('直接 XHR 正确编码请求体，取消会终止活动请求', async () => {
  const { makeTransport } = await import('../src/platform');
  const calls: { body?: string; headers: Record<string, string>; aborted: boolean; xhr: any }[] = [];
  class FakeXHR {
    response = { ok: true };
    status = 200;
    onload?: () => void;
    onabort?: () => void;
    entry = { body: undefined as string | undefined, headers: {} as Record<string, string>, aborted: false, xhr: this };
    constructor() { calls.push(this.entry); }
    open() {}
    setRequestHeader(key: string, value: string) { this.entry.headers[key] = value; }
    send(body: string) { this.entry.body = body; }
    abort() { this.entry.aborted = true; this.onabort?.(); }
  }
  Object.assign((globalThis as any).Zotero, { getMainWindow: () => ({ XMLHttpRequest: FakeXHR }) });
  const transport = makeTransport();
  const completed = transport.post('https://example.com', { file_data: 'a+b/c=', client_secret: 'secret&value' }, new AbortController().signal);
  assert.equal(calls[0].body, 'file_data=a%2Bb%2Fc%3D&client_secret=secret%26value');
  calls[0].xhr.onload();
  assert.deepEqual(await completed, { ok: true });
  const controller = new AbortController();
  const cancelled = transport.get('https://example.com', controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /取消/);
  assert.equal(calls[1].aborted, true);
});
