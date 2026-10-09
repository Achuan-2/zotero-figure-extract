import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPreferences, type PreferencesAPI } from '../src/preferences-ui';
import { defaults, type Switches } from '../src/domain';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Provider } from '../src/providers';

class Control extends EventTarget {
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  href = '';
  textContent = '';
  classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name)
  };
}

function fixture(overrides: Partial<PreferencesAPI> = {}) {
  const fields = Object.fromEntries(['provider', 'api-key', 'api-key-label', 'secret-key', 'secret-field', 'provider-help', 'key-link', 'save', 'verify', 'status', 'figure', 'table', 'formula']
    .map(name => [name, new Control()]));
  const root = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => fields[selector.replace('#figureextract-pref-', '')]
  });
  let switches: Switches = { ...defaults };
  let credentials = { apiKey: 'existing-key', secretKey: 'existing-secret' };
  let verifications = 0;
  let provider: Provider = 'baidu';
  const api: PreferencesAPI = {
    getProvider: () => provider,
    setProvider: value => { provider = value; },
    getCredentials: () => credentials,
    saveCredentials: async value => { credentials = value; },
    getSwitches: () => switches,
    setSwitches: value => { switches = value; },
    verify: async () => { verifications++; },
    clearToken() {},
    openExternal() {},
    ...overrides
  };
  bindPreferences(root as unknown as Element, api);
  return { fields, root, api, state: () => ({ switches, credentials, verifications }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('设置页提供对应接口的获取 Key 链接，阻止页面跳转并调用系统浏览器', () => {
  const links: string[] = [];
  const { fields } = fixture({ getProvider: () => 'aistudio', openExternal: url => { links.push(url); } });
  assert.equal(fields['key-link'].href, 'https://aistudio.baidu.com/account/accessToken');
  const event = new Event('click', { cancelable: true });
  fields['key-link'].dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  fields.provider.value = 'baidu';
  fields.provider.dispatchEvent(new Event('change'));
  fields['key-link'].dispatchEvent(new Event('click', { cancelable: true }));
  assert.deepEqual(links, ['https://aistudio.baidu.com/account/accessToken', 'https://console.bce.baidu.com/ai-engine/ocr/overview/index']);
});

test('切换接口隐藏 Secret Key、独立加载与保存凭据，并保留未保存的编辑', async () => {
  const stored = {
    baidu: { apiKey: 'cloud-key', secretKey: 'cloud-secret' },
    aistudio: { apiKey: 'studio-key', secretKey: '' }
  };
  const { fields } = fixture({
    getCredentials: (provider = 'baidu') => stored[provider],
    saveCredentials: async (value, provider = 'baidu') => { stored[provider] = value; }
  });
  fields['secret-key'].value = 'unsaved-cloud-secret';
  fields.provider.value = 'aistudio';
  fields.provider.dispatchEvent(new Event('change'));
  assert.equal(fields['secret-field'].hidden, true);
  assert.equal(fields['secret-key'].disabled, true);
  assert.equal(fields['api-key'].value, 'studio-key');
  fields['api-key'].value = 'new-studio-key';
  fields.save.dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(stored.aistudio, { apiKey: 'new-studio-key', secretKey: '' });
  assert.deepEqual(stored.baidu, { apiKey: 'cloud-key', secretKey: 'cloud-secret' });
  fields.provider.value = 'baidu';
  fields.provider.dispatchEvent(new Event('change'));
  assert.equal(fields['secret-field'].hidden, false);
  assert.equal(fields['api-key'].value, 'cloud-key');
  assert.equal(fields['secret-key'].value, 'unsaved-cloud-secret');
});

test('设置页沿用已有凭据；保存不请求百度，独立开关与提取窗口共用配置', async () => {
  const { fields, root, api, state } = fixture();
  assert.equal(fields['api-key'].value, 'existing-key');
  fields['api-key'].value = 'new-key';
  fields['secret-key'].value = 'new-secret';
  fields.save.dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(state().credentials, { apiKey: 'new-key', secretKey: 'new-secret' });
  assert.equal(state().verifications, 0);
  assert.equal(fields.status.textContent, '设置已保存。');
  fields.table.checked = false;
  fields.table.dispatchEvent(new Event('change'));
  assert.deepEqual(api.getSwitches(), { figure: true, table: false, formula: true });
  api.setSwitches({ figure: false, table: true, formula: false });
  root.dispatchEvent(new Event('showing'));
  assert.equal(fields.figure.checked, false);
  assert.equal(fields.table.checked, true);
  assert.equal(fields.formula.checked, false);
  const reopened = fixture(api);
  assert.equal(reopened.fields['api-key'].value, 'new-key');
  assert.equal(reopened.fields.figure.checked, false);
});

test('鉴权期间阻止重复提交；关闭设置页取消请求并清空字段', async () => {
  let signal: AbortSignal | undefined;
  let requests = 0;
  const { fields, root } = fixture({
    verify: async (_provider, value) => {
      signal = value;
      requests++;
      await new Promise<void>((_resolve, reject) => {
        value.addEventListener('abort', () => reject(new Error('取消')), { once: true });
      });
    }
  });
  fields.verify.dispatchEvent(new Event('click'));
  fields.verify.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(requests, 1);
  assert.equal(fields.verify.disabled, true);
  assert.equal(fields['api-key'].disabled, true);
  root.dispatchEvent(new Event('unload'));
  await settle();
  assert.equal(signal?.aborted, true);
  assert.equal(fields['api-key'].value, '');
  assert.equal(fields['secret-key'].value, '');
});

test('保存失败不发出鉴权请求，并显示错误后恢复可操作状态', async () => {
  const { fields, state } = fixture({ saveCredentials: async () => { throw new Error('请填写完整凭据'); } });
  fields.verify.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(state().verifications, 0);
  assert.equal(fields.status.textContent, '请填写完整凭据');
  assert.equal(fields.status.classes.has('error'), true);
  assert.equal(fields.verify.disabled, false);
});

test('保存等待期间关闭页面，不再开始鉴权', async () => {
  let finishSave: (() => void) | undefined;
  const { fields, root, state } = fixture({
    saveCredentials: () => new Promise(resolve => { finishSave = resolve; })
  });
  fields.verify.dispatchEvent(new Event('click'));
  root.dispatchEvent(new Event('unload'));
  finishSave!();
  await settle();
  assert.equal(state().verifications, 0);
});

test('设置脚本在隔离沙盒中等待片段 load，再读取配置并绑定一次', async () => {
  const built = await build({ entryPoints: ['src/preferences.ts'], bundle: true, write: false, format: 'iife', globalName: 'FigureExtractPreferences', target: 'firefox115' });
  const fields = Object.fromEntries(['provider', 'api-key', 'api-key-label', 'secret-key', 'secret-field', 'provider-help', 'key-link', 'save', 'verify', 'status', 'figure', 'table', 'formula']
    .map(name => [name, new Control()]));
  const root = Object.assign(new EventTarget(), {
    id: 'figureextract-pref-root',
    querySelector: (selector: string) => fields[selector.replace('#figureextract-pref-', '')]
  });
  let listener: ((event: { target: unknown }) => void) | undefined;
  let credentialReads = 0;
  const sandbox = {
    document: {
      addEventListener(name: string, callback: typeof listener, capture: boolean) {
        assert.equal(name, 'load');
        assert.equal(capture, true);
        listener = callback;
      },
      removeEventListener(name: string, callback: typeof listener, capture: boolean) {
        assert.equal(name, 'load');
        assert.equal(callback, listener);
        assert.equal(capture, true);
        listener = undefined;
      }
    },
    AbortController,
    Zotero: { Prefs: { get: () => undefined } },
    Services: { logins: { findLogins: () => { credentialReads++; return [{ username: 'stored-key', password: 'stored-secret' }]; } } },
    Components: {}, IOUtils: {}, PathUtils: {}
  };
  vm.runInNewContext(built.outputFiles[0].text, sandbox);
  assert.equal(credentialReads, 0);
  listener!({ target: { id: 'another-pane' } });
  assert.equal(credentialReads, 0);
  listener!({ target: root });
  assert.equal(credentialReads, 1);
  assert.equal(fields.provider.value, 'aistudio');
  assert.equal(fields['api-key'].value, 'stored-secret');
  assert.equal(fields['secret-field'].hidden, true);
  assert.equal(fields.figure.checked, true);
  assert.equal(listener, undefined);
});
