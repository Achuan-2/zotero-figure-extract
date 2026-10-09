import type { Reader } from './platform';

const SIDEBAR_ID = 'figureextract-sidebar-button';
const PANEL_ID = 'figureextract-sidebar-panel';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

interface EntryState {
  sidebar: HTMLButtonElement;
  panel: HTMLElement;
  style: HTMLStyleElement;
  observer: MutationObserver;
  unload: () => void;
  nativeClick: (event: Event) => void;
  show: () => void;
  dispose?: () => void;
  closed: boolean;
}

/** Reader sidebar tabs have no public extension hook. Keep DOM adaptation here. */
export class ReaderEntryManager {
  private readonly documents = new Map<Document, EntryState>();

  constructor(private readonly initialize: (reader: Reader, doc: Document) => Promise<() => void>,
    private readonly loadMarkup: () => Promise<string>,
    private readonly onError: (error: unknown) => void = () => {}) {}

  attach(reader: Reader, doc: Document): void {
    if (reader.type !== 'pdf' || !doc.defaultView || this.documents.has(doc)) return;
    const win = doc.defaultView;
    const realm = (win as Window & { wrappedJSObject?: Window }).wrappedJSObject ?? win;
    const sidebar = doc.createElementNS(HTML_NS, 'button') as HTMLButtonElement;
    sidebar.id = SIDEBAR_ID;
    sidebar.type = 'button';
    sidebar.className = 'toolbar-button figureextract-button';
    sidebar.title = '图表公式：识别与提取';
    sidebar.setAttribute('role', 'tab');
    sidebar.setAttribute('aria-label', sidebar.title);
    sidebar.setAttribute('aria-controls', PANEL_ID);
    sidebar.setAttribute('aria-selected', 'false');
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('viewBox', '0 0 20 20');
    icon.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 2H2v4m12-4h4v4M2 14v4h4m12-4v4h-4M5 12l3-3 3 3 2-2 2 3M6 6h.01');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.append(path);
    sidebar.append(icon);

    const panel = doc.createElementNS(HTML_NS, 'div') as HTMLElement;
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', SIDEBAR_ID);
    panel.hidden = true;
    const frame = doc.createElementNS(HTML_NS, 'iframe') as HTMLIFrameElement;
    frame.title = '图、表、公式识别';
    panel.append(frame);
    const style = doc.createElementNS(HTML_NS, 'style') as HTMLStyleElement;
    style.textContent = `
      #sidebarContainer.figureextract-active #sidebarContent > :not(#${PANEL_ID}) { display: none !important; }
      #${PANEL_ID} { height: 100%; min-height: 0; }
      #${PANEL_ID}[hidden] { display: none !important; }
      #${PANEL_ID} iframe { display: block; width: 100%; height: 100%; border: 0; }
      #${SIDEBAR_ID}[aria-selected="true"] { color: var(--accent-blue, #4072e5); background: var(--accent-blue10, #edf2ff); }
      #sidebarContainer.figureextract-active .sidebar-toolbar button.active:not(#${SIDEBAR_ID}) { background: transparent; }
    `;
    let active = false;
    let requested = false;
    let loadedDocument: Document | null = null;
    let generation = 0;
    const setActive = (value: boolean) => {
      active = value;
      panel.hidden = !value;
      sidebar.setAttribute('aria-selected', String(value));
      doc.getElementById('sidebarContainer')?.classList.toggle('figureextract-active', value);
    };
    const show = () => {
      reader._internalReader?.toggleSidebar?.(true);
      setActive(true);
      if (!requested) {
        requested = true;
        // Inherit the reader's origin instead of navigating content to a chrome URL.
        void this.loadMarkup().then(markup => {
          if (!state.closed) frame.srcdoc = markup;
        }).catch(error => { requested = false; if (!state.closed) this.onError(error); });
      }
    };
    sidebar.addEventListener('click', show);
    const nativeClick = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('#viewThumbnail, #viewAnnotations, #viewOutline')) setActive(false);
    };
    doc.addEventListener('click', nativeClick, true);
    // UI callbacks stay in the plugin sandbox; no API object is injected into iframe globals.
    frame.addEventListener('load', () => {
      const content = frame.contentDocument;
      if (!requested || !content?.getElementById('start') || state.closed || content === loadedDocument) return;
      loadedDocument = content;
      const current = ++generation;
      state.dispose?.();
      state.dispose = undefined;
      void this.initialize(reader, content).then(dispose => {
        if (state.closed || current !== generation) dispose(); else state.dispose = dispose;
      }).catch(error => {
        if (!state.closed && current === generation) { loadedDocument = null; this.onError(error); }
      });
    });

    const mount = () => {
      if (!doc.getElementById(SIDEBAR_ID)) {
        doc.querySelector('#sidebarContainer .sidebar-toolbar .start')?.appendChild(sidebar);
      }
      if (!doc.getElementById(PANEL_ID)) doc.getElementById('sidebarContent')?.appendChild(panel);
      if (!style.isConnected) doc.head.appendChild(style);
      const container = doc.getElementById('sidebarContainer');
      if (container?.classList.contains('figureextract-active') !== active) container?.classList.toggle('figureextract-active', active);
    };
    // Covers delayed sidebar rendering and React replacing its DOM containers.
    const readerRealm = realm as Window & { MutationObserver: typeof MutationObserver; Object: typeof Object };
    const observer = new readerRealm.MutationObserver(mount);
    const unload = () => this.detach(doc);
    const state: EntryState = { sidebar, panel, style, observer, unload, nativeClick, show, closed: false };
    this.documents.set(doc, state);
    mount();
    // Gecko rejects a privileged JS dictionary passed into the reader realm.
    const observerOptions = new readerRealm.Object() as MutationObserverInit;
    observerOptions.childList = true;
    observerOptions.subtree = true;
    observer.observe(doc, observerOptions);
    win.addEventListener('unload', unload);
  }

  open(reader: Reader): void {
    const doc = reader._iframeWindow?.document as Document | undefined;
    if (!doc) throw new Error('PDF 阅读器尚未准备好');
    this.attach(reader, doc);
    this.documents.get(doc)?.show();
  }

  private detach(doc: Document): void {
    const state = this.documents.get(doc);
    if (!state) return;
    state.closed = true;
    state.observer.disconnect();
    doc.removeEventListener('click', state.nativeClick, true);
    doc.defaultView?.removeEventListener('unload', state.unload);
    state.dispose?.();
    doc.getElementById('sidebarContainer')?.classList.remove('figureextract-active');
    state.panel.remove();
    state.style.remove();
    state.sidebar.remove();
    this.documents.delete(doc);
  }

  clear(): void {
    for (const doc of this.documents.keys()) this.detach(doc);
  }
}
