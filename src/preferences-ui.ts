import type { Credentials } from './baidu';
import { defaults, type Kind, type Switches } from './domain';

export interface PreferencesAPI {
  getCredentials(): Credentials;
  saveCredentials(value: Credentials): Promise<void>;
  getSwitches(): Switches;
  setSwitches(value: Switches): void;
  verify(signal: AbortSignal): Promise<void>;
  clearToken(): void;
}

/** Bind only this pane's nodes: all Zotero preference panes share one document. */
export function bindPreferences(root: Element, api: PreferencesAPI): void {
  function element<T extends HTMLElement>(name: string): T {
    const node = root.querySelector(`#figureextract-pref-${name}`);
    if (!node) throw new Error(`缺少设置元素：${name}`);
    return node as T;
  }
  const apiKey = element<HTMLInputElement>('api-key');
  const secretKey = element<HTMLInputElement>('secret-key');
  const saveButton = element<HTMLButtonElement>('save');
  const verifyButton = element<HTMLButtonElement>('verify');
  const status = element('status');
  const switches = (Object.keys(defaults) as Kind[]).map(kind => ({ kind, input: element<HTMLInputElement>(kind) }));
  let busy = false;
  let closed = false;
  let verification: AbortController | undefined;

  function message(text: string, error = false): void {
    if (closed) return;
    status.textContent = text;
    status.classList.toggle('figureextract-pref-error', error);
  }
  function refreshSwitches(): void {
    const value = api.getSwitches();
    for (const { kind, input } of switches) input.checked = value[kind];
  }
  function lock(value: boolean): void {
    busy = value;
    for (const node of [apiKey, secretKey, saveButton, verifyButton]) node.disabled = value;
  }
  async function save(verify: boolean): Promise<void> {
    if (busy || closed) return;
    lock(true);
    message(verify ? '正在保存并验证百度凭据…' : '正在保存…');
    try {
      await api.saveCredentials({ apiKey: apiKey.value, secretKey: secretKey.value });
      api.clearToken();
      // Saving to the login manager can await user interaction. Do not start a
      // request if the settings window was closed during that operation.
      if (closed) return;
      if (verify) {
        verification = new AbortController();
        await api.verify(verification.signal);
      }
      message(verify ? '百度鉴权成功。服务权限和额度会在实际识别时检查。' : '设置已保存。');
    } catch (error) {
      message(error instanceof Error ? error.message : String(error), true);
    } finally {
      verification = undefined;
      if (!closed) lock(false);
    }
  }

  refreshSwitches();
  try {
    const value = api.getCredentials();
    apiKey.value = value.apiKey;
    secretKey.value = value.secretKey;
  } catch {
    message('无法读取凭据，请解锁 Zotero 登录管理器后重新打开设置。', true);
  }
  for (const { input } of switches) {
    input.addEventListener('change', () => {
      const value = Object.fromEntries(switches.map(({ kind, input }) => [kind, input.checked])) as Switches;
      api.setSwitches(value);
    });
  }
  saveButton.addEventListener('click', () => { void save(false); });
  verifyButton.addEventListener('click', () => { void save(true); });
  root.addEventListener('showing', refreshSwitches);
  root.addEventListener('unload', () => {
    closed = true;
    verification?.abort();
    api.clearToken();
    apiKey.value = secretKey.value = '';
  }, { once: true });
}
