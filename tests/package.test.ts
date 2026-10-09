import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { validatePackage } from '../scripts/validate-package.mjs';

async function packageFixture(): Promise<Record<string, Uint8Array>> {
  return {
    'manifest.json': new Uint8Array(await readFile('addon/manifest.json')),
    'bootstrap.js': new Uint8Array(await readFile('addon/bootstrap.js')),
    'chrome/content/plugin.js': new TextEncoder().encode('/* bundle */'),
    'chrome/content/ui.js': new TextEncoder().encode('/* bundle */'),
    'chrome/content/preferences.js': new TextEncoder().encode('/* preferences bundle */'),
    'chrome/content/preferences.xhtml': new Uint8Array(await readFile('addon/chrome/content/preferences.xhtml')),
    'chrome/content/preferences.css': new Uint8Array(await readFile('addon/chrome/content/preferences.css'))
  };
}

test('清单必填字段和 HTTPS 更新地址齐全；缺失或不安全时阻止打包', async () => {
  const files = await packageFixture();
  const manifest = validatePackage(files);
  assert.equal(new URL(manifest.applications.zotero.update_url).protocol, 'https:');
  delete manifest.applications.zotero.update_url;
  const invalid = { ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) };
  assert.throws(() => validatePackage(invalid), /applications.zotero.update_url not provided/);
  for (const updateURL of ['chrome://figureextract/content/updates.json', 'http://example.test/updates.json', 'file:///updates.json']) {
    manifest.applications.zotero.update_url = updateURL;
    const insecure = { ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) };
    assert.throws(() => validatePackage(insecure), /HTTPS/);
  }
});

test('本机安装管理器的安全更新规则拒绝 chrome URL，接受新清单的 HTTPS 地址', { skip: !existsSync('C:/Program Files/Zotero/omni.ja') }, async () => {
  const archive = unzipSync(readFileSync('C:/Program Files/Zotero/omni.ja'), { filter: file => file.name === 'modules/addons/XPIDatabase.sys.mjs' });
  const source = strFromU8(archive['modules/addons/XPIDatabase.sys.mjs']);
  const getter = source.match(/get providesUpdatesSecurely\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(getter, '找不到安全更新规则');
  const check = new Function(getter[1]);
  assert.equal(check.call({ updateURL: 'chrome://figureextract/content/updates.json' }), false);
  const manifest = JSON.parse(await readFile('addon/manifest.json', 'utf8'));
  assert.equal(check.call({ updateURL: manifest.applications.zotero.update_url }), true);
});

const installedRuntime = 'C:/Program Files/Zotero/omni.ja';
test('使用本机 Zotero 安装器的原始必填字段校验：旧清单失败，新清单通过', { skip: !existsSync(installedRuntime) }, async () => {
  const archive = unzipSync(readFileSync(installedRuntime), { filter: file => file.name === 'modules/Extension.sys.mjs' });
  const source = strFromU8(archive['modules/Extension.sys.mjs']);
  const start = source.indexOf('if (this.type == "extension") {', source.indexOf('manifest = normalized.value;'));
  assert.ok(start >= 0, '找不到本机 Zotero 的清单校验逻辑');
  const end = source.indexOf('manifest.browser_specific_settings = undefined;', start);
  assert.ok(end > start);
  const checks = source.slice(start, end) + '\n}';
  const manifest = JSON.parse(await readFile('addon/manifest.json', 'utf8'));
  const errors: string[] = [];
  const sandbox = { manifest, type: 'extension', manifestError: (message: string) => errors.push(message) };
  vm.runInNewContext(checks, sandbox);
  assert.deepEqual(errors, []);
  delete manifest.applications.zotero.update_url;
  vm.runInNewContext(checks, sandbox);
  assert.deepEqual(errors, ['applications.zotero.update_url not provided']);
});

test('bootstrap 注册 chrome、启动/卸载插件，并清理 chromeHandle', async () => {
  const events: string[] = [];
  const sandbox: Record<string, any> = {
    Zotero: { getMainWindow: () => ({ AbortController, TextEncoder }) },
    IOUtils: {}, PathUtils: {},
    ChromeUtils: { importGlobalProperties() {} },
    Components: { classes: { '@mozilla.org/addons/addon-manager-startup;1': {
      getService: () => ({ registerChrome: () => { events.push('chrome'); return { destruct() { events.push('destruct'); } }; } })
    } }, interfaces: { amIAddonManagerStartup: {} } },
    Services: { io: { newURI: (value: string) => value }, scriptloader: {
      loadSubScript(_url: string, scope: Record<string, unknown>) { scope.FigureExtract = {
        async startup() { events.push('startup'); }, async shutdown() { events.push('shutdown'); },
        onMainWindowLoad() { events.push('load'); }, onMainWindowUnload() { events.push('unload'); }
      }; }
    } }
  };
  vm.createContext(sandbox);
  vm.runInContext(await readFile('addon/bootstrap.js', 'utf8'), sandbox);
  await sandbox.startup({ rootURI: 'file:///plugin/' });
  sandbox.onMainWindowLoad({ window: {} });
  sandbox.onMainWindowUnload({ window: {} });
  await sandbox.shutdown();
  assert.deepEqual(events, ['chrome', 'startup', 'load', 'unload', 'shutdown', 'destruct']);
  assert.equal(sandbox.pluginScope, null);
  assert.equal(sandbox.chromeHandle, null);
});

test('插件打包可在独立 bootstrap 沙盒执行，生命周期注册及清理正确', async () => {
  const built = await build({ entryPoints: ['src/plugin.ts'], bundle: true, write: false, format: 'iife', globalName: 'FigureExtract', target: 'firefox115' });
  const events: string[] = [];
  const sandbox: Record<string, any> = {
    AbortController, TextEncoder, Zotero: {
      getMainWindows: () => [],
      PreferencePanes: {
        async register(options: Record<string, any>) {
          assert.equal(options.pluginID, 'zotero-figure-extract@achuan');
          assert.equal(options.label, 'Figure Extract');
          assert.equal(options.src, 'chrome://figureextract/content/preferences.xhtml');
          assert.deepEqual(Array.from(options.scripts), ['chrome://figureextract/content/preferences.js']);
          assert.deepEqual(Array.from(options.stylesheets), ['chrome://figureextract/content/preferences.css']);
          events.push('preferences:register');
          return options.id;
        },
        unregister(id: string) {
          assert.equal(id, 'figureextract-preferences');
          events.push('preferences:unregister');
        }
      },
      Reader: { registerEventListener(name: string) { events.push('register:' + name); }, unregisterEventListener(name: string) { events.push('unregister:' + name); } }
    }, Services: {}, Components: {}, IOUtils: {}, PathUtils: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(built.outputFiles[0].text, sandbox);
  await sandbox.FigureExtract.startup();
  await sandbox.FigureExtract.shutdown();
  assert.deepEqual(events, ['preferences:register', 'register:renderToolbar', 'preferences:unregister', 'unregister:renderToolbar']);
});

test('安装包必须包含设置页面和脚本，片段不使用完整 HTML 文档', async () => {
  const files = await packageFixture();
  delete files['chrome/content/preferences.js'];
  assert.throws(() => validatePackage(files), /安装包缺少文件：chrome\/content\/preferences.js/);
  const markup = await readFile('addon/chrome/content/preferences.xhtml', 'utf8');
  assert.doesNotMatch(markup, /<!DOCTYPE|<html[\s>]|<head[\s>]|<body[\s>]/i);
  assert.match(markup, /id="figureextract-pref-root"/);
  assert.doesNotMatch(markup, /onload=/);
});

test('本机 Zotero 的真实设置页注册器接受插件注册参数并可注销', { skip: !existsSync('C:/Program Files/Zotero/app/omni.ja') }, async () => {
  const archive = unzipSync(readFileSync('C:/Program Files/Zotero/app/omni.ja'), {
    filter: file => file.name === 'chrome/content/zotero/xpcom/preferencePanes.js'
  });
  const native = strFromU8(archive['chrome/content/zotero/xpcom/preferencePanes.js']);
  const built = await build({ entryPoints: ['src/plugin.ts'], bundle: true, write: false, format: 'iife', globalName: 'FigureExtract', target: 'firefox115' });
  const sandbox: Record<string, any> = {
    AbortController, TextEncoder,
    Services: { wm: { getEnumerator: () => [] } },
    Components: {}, IOUtils: {}, PathUtils: {},
    Zotero: {
      getMainWindows: () => [], debug() {},
      Plugins: { resolveURI: async (_id: string, uri: string) => uri, addObserver() {} },
      Reader: { registerEventListener() {}, unregisterEventListener() {} }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(native, sandbox);
  vm.runInContext(built.outputFiles[0].text, sandbox);
  await sandbox.FigureExtract.startup();
  const pane = sandbox.Zotero.PreferencePanes.pluginPanes[0];
  assert.equal(pane.id, 'figureextract-preferences');
  assert.equal(pane.rawLabel, 'Figure Extract');
  assert.equal(pane.defaultXUL, true);
  assert.equal(pane.src, 'chrome://figureextract/content/preferences.xhtml');
  await sandbox.FigureExtract.shutdown();
  assert.equal(sandbox.Zotero.PreferencePanes.pluginPanes.length, 0);
});
