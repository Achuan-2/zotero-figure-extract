import { BaiduClient } from './baidu';
import { getCredentials, saveCredentials, getSwitches, setSwitches, makeTransport } from './platform';
import { bindPreferences } from './preferences-ui';

const mounted = new WeakSet<Element>();

// Called by Zotero after inserting the XHTML fragment, not on window load.
export function init(root: Element): void {
  if (mounted.has(root)) return;
  mounted.add(root);
  const client = new BaiduClient(makeTransport(), getCredentials);
  bindPreferences(root, {
    getCredentials, saveCredentials, getSwitches, setSwitches,
    verify: signal => client.verify(signal),
    clearToken: () => client.clearToken()
  });
}

// Zotero loads this script into a pane sandbox before inserting the fragment.
// Listen for its synthetic load event instead of resolving sandbox globals
// from an inline handler in the shared preferences window.
function onPaneLoad(event: Event): void {
  const root = event.target as Element | null;
  if (root?.id !== 'figureextract-pref-root') return;
  document.removeEventListener('load', onPaneLoad, true);
  init(root);
}
document.addEventListener('load', onPaneLoad, true);
