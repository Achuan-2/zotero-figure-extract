import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { ReaderEntryManager } from '../src/reader-entry';
import type { Reader } from '../src/platform';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const markup = async () => '<!DOCTYPE html><html><body><button id="start">开始识别</button></body></html>';
function fixture() {
  const dom = new JSDOM('<html><head></head><body><div class="toolbar"><div class="custom-sections"></div></div></body></html>', { runScripts: 'outside-only' });
  const doc = dom.window.document;
  let toggles = 0;
  const reader = { type: 'pdf', _initPromise: Promise.resolve(), _iframeWindow: { document: doc },
    _internalReader: { toggleSidebar: () => { toggles++; } } } as unknown as Reader;
  function renderSidebar() {
    doc.getElementById('sidebarContainer')?.remove();
    const container = doc.createElement('div');
    container.id = 'sidebarContainer';
    container.innerHTML = '<div class="sidebar-toolbar"><div class="start"><button id="viewAnnotations">标注</button></div></div><div id="sidebarContent"><div class="viewWrapper">原生标注</div></div>';
    doc.body.append(container);
  }
  return { dom, doc, reader, renderSidebar, toggles: () => toggles };
}

test('MutationObserver 配置字典属于阅读器窗口，避免 Gecko 跨权限包装拒绝读取属性', () => {
  const page = fixture();
  const NativeObserver = page.dom.window.MutationObserver;
  let observed = false;
  page.dom.window.MutationObserver = class extends NativeObserver {
    observe(target: globalThis.Node, options: MutationObserverInit): void {
      assert.equal(Object.getPrototypeOf(options), page.dom.window.Object.prototype);
      assert.notEqual(Object.getPrototypeOf(options), Object.prototype);
      observed = true;
      super.observe(target, options);
    }
  };
  const manager = new ReaderEntryManager(async () => () => {}, markup);
  manager.attach(page.reader, page.doc);
  assert.equal(observed, true);
  manager.clear();
  page.dom.window.close();
});

test('延迟侧栏和 React 重绘后补齐入口；不添加工具栏按钮，切回标注隐藏识别面板', async () => {
  const page = fixture();
  const manager = new ReaderEntryManager(async () => () => {}, markup);
  manager.attach(page.reader, page.doc);
  assert.equal(page.doc.querySelector('.toolbar button'), null);
  page.renderSidebar();
  await settle();
  const button = page.doc.getElementById('figureextract-sidebar-button')!;
  const panel = page.doc.getElementById('figureextract-sidebar-panel')!;
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(page.toggles(), 1);
  await settle();
  assert.match(panel.querySelector('iframe')!.srcdoc, /开始识别/);
  assert.equal(panel.querySelector('iframe')!.getAttribute('src'), null);
  page.doc.getElementById('viewAnnotations')!.click();
  assert.equal(panel.hidden, true);
  assert.equal(button.getAttribute('aria-selected'), 'false');
  manager.open(page.reader);
  manager.attach(page.reader, page.doc);
  page.renderSidebar();
  await settle();
  assert.equal(page.doc.getElementById('figureextract-sidebar-button'), button);
  assert.equal(page.doc.getElementById('figureextract-sidebar-panel'), panel);
  assert.equal(page.doc.querySelectorAll('#figureextract-sidebar-button').length, 1);
  assert.equal(page.doc.querySelector('.toolbar button'), null);
  manager.clear();
  assert.equal(page.doc.getElementById('figureextract-sidebar-panel'), null);
  assert.equal(page.doc.head.querySelector('style'), null);
  assert.equal(page.doc.getElementById('sidebarContainer')!.classList.contains('figureextract-active'), false);
  page.renderSidebar();
  await settle();
  assert.equal(page.doc.getElementById('figureextract-sidebar-button'), null);
  page.dom.window.close();
});

test('关闭阅读器时清理、取消初始化中的 UI；非 PDF 不挂载', async () => {
  const page = fixture();
  page.renderSidebar();
  let finish: ((dispose: () => void) => void) | undefined;
  let initialized = 0, disposed = 0;
  const manager = new ReaderEntryManager(async reader => {
    assert.equal(reader, page.reader);
    initialized++;
    return new Promise(resolve => { finish = resolve; });
  }, markup);
  manager.attach({ ...page.reader, type: 'epub' }, page.doc);
  assert.equal(page.doc.getElementById('figureextract-sidebar-button'), null);
  manager.open(page.reader);
  const frame = page.doc.querySelector('iframe')!;
  const content = new JSDOM('<button id="start">开始识别</button>');
  Object.defineProperty(frame, 'contentDocument', { value: content.window.document });
  frame.dispatchEvent(new page.dom.window.Event('load'));
  frame.dispatchEvent(new page.dom.window.Event('load'));
  assert.equal(initialized, 1);
  page.dom.window.dispatchEvent(new page.dom.window.Event('unload'));
  finish!(() => { disposed++; });
  await settle();
  assert.equal(disposed, 1);
  assert.equal(page.doc.getElementById('figureextract-sidebar-panel'), null);
  manager.clear();
  page.dom.window.close();
  content.window.close();
});

test('启用插件时给已打开 PDF 补齐侧栏；工具栏事件仅用于新阅读器就绪，未调用 append', async () => {
  const page = fixture();
  page.renderSidebar();
  const built = await build({ entryPoints: ['src/plugin.ts'], bundle: true, write: false, format: 'iife', globalName: 'FigureExtract', target: 'firefox115' });
  let ready: ((event: unknown) => void) | undefined;
  const sandbox: Record<string, any> = {
    AbortController, TextEncoder, Services: {}, Components: {}, IOUtils: {}, PathUtils: {},
    Zotero: {
      getMainWindows: () => [], logError(error: unknown) { throw error; },
      PreferencePanes: { register: async () => 'figureextract-preferences', unregister() {} },
      Reader: { _readers: [page.reader], registerEventListener(_name: string, callback: typeof ready) { ready = callback; }, unregisterEventListener() {} }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(built.outputFiles[0].text, sandbox);
  await sandbox.FigureExtract.startup();
  await settle();
  ready!({ reader: page.reader, doc: page.doc, append() { assert.fail('不得添加工具栏按钮'); } });
  assert.ok(page.doc.getElementById('figureextract-sidebar-button'));
  assert.equal(page.doc.querySelector('.toolbar button'), null);
  await sandbox.FigureExtract.shutdown();
  assert.equal(page.doc.getElementById('figureextract-sidebar-button'), null);
  page.dom.window.close();
});
