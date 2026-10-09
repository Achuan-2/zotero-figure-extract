import type { Credentials } from './baidu';
import type { CredentialSettingsAPI } from './contracts';
import { credentialURLs, isProvider, type Provider } from './providers';

export interface CredentialControls {
  provider: HTMLSelectElement;
  apiKey: HTMLInputElement;
  apiKeyLabel: HTMLElement;
  secretKey: HTMLInputElement;
  secretField: HTMLElement;
  help: HTMLElement;
  keyLink: HTMLAnchorElement;
  status: HTMLElement;
  save: HTMLButtonElement;
  verify: HTMLButtonElement;
}

/** Shared by the Zotero preferences pane and the PDF extraction dialog. */
export function bindCredentialSettings(controls: CredentialControls, api: CredentialSettingsAPI,
  options: { onBusy?: (busy: boolean) => void; blocked?: () => boolean } = {}) {
  const { provider: select, apiKey, secretKey, status } = controls;
  const drafts = new Map<Provider, Credentials>();
  let provider = api.getProvider();
  let busy = false;
  let closed = false;
  let verification: AbortController | undefined;

  const read = (): Credentials => ({ apiKey: apiKey.value, secretKey: provider === 'baidu' ? secretKey.value : '' });
  function message(text: string, error = false): void {
    if (closed) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function renderProvider(): void {
    select.value = provider;
    controls.secretField.hidden = provider === 'aistudio';
    controls.apiKeyLabel.textContent = provider === 'aistudio' ? 'API Key / Access Token' : 'API Key';
    controls.keyLink.href = credentialURLs[provider];
    controls.keyLink.textContent = provider === 'aistudio' ? '获取 AI Studio API Key' : '获取百度智能云 API Key / Secret Key';
    controls.help.textContent = provider === 'aistudio'
      ? '填写 AI Studio PaddleOCR 页面的 API Key / Access Token，无需 Secret Key。模型使用 PaddleOCR-VL-1.6。'
      : '开通百度智能云「文档解析（PaddleOCR-VL）」后，填写应用的 API Key 和 Secret Key。';
    try {
      const value = drafts.get(provider) ?? api.getCredentials(provider);
      apiKey.value = value.apiKey;
      secretKey.value = value.secretKey;
      message('两套接口的凭据分别保存在 Zotero 登录管理器中。验证不上传 PDF。');
    } catch {
      apiKey.value = secretKey.value = '';
      message('无法读取凭据，请解锁 Zotero 登录管理器后重试。', true);
    }
  }
  function setDisabled(disabled: boolean): void {
    for (const node of [select, apiKey, controls.save, controls.verify]) node.disabled = disabled || busy;
    secretKey.disabled = disabled || busy || provider === 'aistudio';
  }
  async function save(verify: boolean): Promise<void> {
    if (busy || closed || options.blocked?.()) return;
    busy = true;
    setDisabled(false);
    options.onBusy?.(true);
    const selected = provider;
    message(verify ? '正在保存并验证凭据…' : '正在保存…');
    try {
      const value = read();
      await api.saveCredentials(value, selected);
      drafts.set(selected, value);
      if (closed) return;
      if (verify) {
        verification = new AbortController();
        await api.verify(selected, verification.signal);
      }
      message(verify ? '鉴权检查成功。服务权限和额度会在实际识别时检查。' : '设置已保存。');
    } catch (error) {
      message(error instanceof Error ? error.message : String(error), true);
    } finally {
      verification = undefined;
      busy = false;
      if (!closed) { setDisabled(Boolean(options.blocked?.())); options.onBusy?.(false); }
    }
  }
  select.addEventListener('change', () => {
    if (busy || closed || options.blocked?.()) { select.value = provider; return; }
    if (!isProvider(select.value)) { select.value = provider; return; }
    drafts.set(provider, read());
    provider = select.value;
    api.setProvider(provider);
    renderProvider();
    setDisabled(false);
  });
  controls.save.addEventListener('click', () => { void save(false); });
  controls.keyLink.addEventListener('click', event => {
    event.preventDefault();
    if (!closed) api.openExternal(credentialURLs[provider]);
  });
  controls.verify.addEventListener('click', () => { void save(true); });
  renderProvider();
  setDisabled(false);
  return {
    setDisabled,
    dispose() {
      closed = true;
      verification?.abort();
      drafts.clear();
      apiKey.value = secretKey.value = '';
    }
  };
}
