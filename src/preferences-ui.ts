import type { CredentialSettingsAPI } from './contracts';
import { defaults, type Kind, type Switches } from './domain';
import { bindCredentialSettings } from './credential-ui';

export interface PreferencesAPI extends CredentialSettingsAPI {
  getSwitches(): Switches;
  setSwitches(value: Switches): void;
  clearToken(): void;
}

/** Bind only this pane's nodes: all Zotero preference panes share one document. */
export function bindPreferences(root: Element, api: PreferencesAPI): void {
  function element<T extends HTMLElement>(name: string): T {
    const node = root.querySelector(`#figureextract-pref-${name}`);
    if (!node) throw new Error(`缺少设置元素：${name}`);
    return node as T;
  }
  const credentials = bindCredentialSettings({
    provider: element('provider'), apiKey: element('api-key'), apiKeyLabel: element('api-key-label'),
    secretKey: element('secret-key'), secretField: element('secret-field'), help: element('provider-help'),
    keyLink: element('key-link'), status: element('status'), save: element('save'), verify: element('verify')
  }, api);
  const switches = (Object.keys(defaults) as Kind[]).map(kind => ({ kind, input: element<HTMLInputElement>(kind) }));
  function refreshSwitches(): void {
    const value = api.getSwitches();
    for (const { kind, input } of switches) input.checked = value[kind];
  }

  refreshSwitches();
  for (const { input } of switches) {
    input.addEventListener('change', () => {
      const value = Object.fromEntries(switches.map(({ kind, input }) => [kind, input.checked])) as Switches;
      api.setSwitches(value);
    });
  }
  root.addEventListener('showing', refreshSwitches);
  root.addEventListener('unload', () => { credentials.dispose(); api.clearToken(); }, { once: true });
}
