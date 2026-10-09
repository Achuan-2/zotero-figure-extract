import { defaults, enabledKinds, labels, type Kind, type Result, type Switches } from './domain';
import type { DialogArguments, Filter, RunOptions } from './contracts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`缺少界面元素：${id}`);
  return result as T;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
}

function init(): void {
  const args = (window as unknown as { arguments: DialogArguments[] }).arguments[0];
  const { api, settingsOnly } = args;
  let results: Result[] = [];
  let filter: Filter = 'all';
  let busy = false;
  let loading = !settingsOnly;
  let credentialsBusy = false;
  let closed = false;
  const start = element<HTMLButtonElement>('start');
  const cancel = element<HTMLButtonElement>('cancel');
  const status = element('status');
  const progress = element<HTMLProgressElement>('progress');
  const scope = element<HTMLSelectElement>('scope');
  const range = element<HTMLInputElement>('page-range');
  const exportSelect = element<HTMLSelectElement>('export');
  const switches = (Object.keys(defaults) as Kind[]).map(kind => ({ kind, input: element<HTMLInputElement>(`recognize-${kind}`) }));
  const selectedSwitches = (): Switches => Object.fromEntries(switches.map(({ kind, input }) => [kind, input.checked])) as Switches;

  function message(text: string, error = false): void {
    if (closed) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  async function action(work: () => Promise<unknown>, success?: string): Promise<void> {
    try { const outcome = await work(); if (success && outcome !== false) message(success); }
    catch (error) { message(error instanceof Error ? error.message : String(error), true); }
  }
  function updateButtons(): void {
    start.disabled = busy || loading || credentialsBusy || enabledKinds(selectedSwitches()).length === 0;
    cancel.disabled = !busy;
    scope.disabled = busy;
    range.disabled = busy;
    element<HTMLInputElement>('force').disabled = busy;
    for (const { input } of switches) input.disabled = busy;
    exportSelect.disabled = busy || !results.length;
    element<HTMLButtonElement>('save-settings').disabled = busy || credentialsBusy;
    element<HTMLButtonElement>('verify').disabled = busy || credentialsBusy;
    element<HTMLInputElement>('api-key').disabled = busy || credentialsBusy;
    element<HTMLInputElement>('secret-key').disabled = busy || credentialsBusy;
    for (const button of document.querySelectorAll<HTMLButtonElement>('.card-actions button')) button.disabled = busy;
  }

  function render(): void {
    if (closed) return;
    const container = element('results');
    container.replaceChildren();
    const visible = results.filter(result => filter === 'all' || result.kind === filter);
    element('empty').hidden = visible.length > 0;
    element('result-count').textContent = `显示 ${visible.length} / ${results.length} 个结果`;
    for (const result of visible) {
      const card = html('article');
      card.className = 'result';
      const heading = html('div');
      heading.className = 'result-heading';
      const badge = html('span');
      badge.className = 'badge';
      badge.textContent = labels[result.kind];
      const page = html('span');
      page.className = 'help';
      page.textContent = `第 ${result.pageIndex + 1} 页`;
      heading.append(badge, page);
      const image = html('img');
      image.src = result.image;
      image.alt = `${labels[result.kind]}，第 ${result.pageIndex + 1} 页`;
      image.loading = 'lazy';
      card.append(heading, image);
      if (result.caption) {
        const caption = html('p');
        caption.className = 'caption';
        caption.textContent = result.caption;
        card.append(caption);
      }
      if (result.content) {
        const text = html('textarea');
        text.readOnly = true;
        text.value = result.content;
        text.setAttribute('aria-label', result.kind === 'formula' ? '公式 LaTeX 识别结果' : '识别文本');
        card.append(text);
      }
      const actions = html('div');
      actions.className = 'card-actions';
      function button(label: string, work: () => Promise<unknown>, success?: string): HTMLButtonElement {
        const node = html('button');
        node.type = 'button';
        node.textContent = label;
        node.addEventListener('click', () => { void action(work, success); });
        actions.append(node);
        return node;
      }
      button('定位原文', () => api.openSource(result));
      button('保存图片', () => api.saveImage(result), '图片已保存');
      if (result.content || result.caption) button(result.kind === 'formula' ? '复制 LaTeX' : '复制文本', async () => {
        api.copyText(result.content || result.caption);
      }, '已复制');
      button('添加标注', () => api.annotate(result), '已添加图像标注');
      button('删除', async () => {
        await api.removeResult(result.id);
        results = results.filter(r => r.id !== result.id);
        render();
      }, '已删除本地提取结果').className = 'danger';
      card.append(actions);
      container.append(card);
    }
    updateButtons();
  }

  document.title = `Figure Extract · ${api.title}`;
  element('document-title').textContent = api.title;
  element('page-count').textContent = `共 ${api.pageCount} 页，打开时位于第 ${api.currentPage} 页`;
  const initialSwitches = api.getSwitches();
  for (const { kind, input } of switches) {
    input.checked = initialSwitches[kind];
    input.addEventListener('change', () => { api.setSwitches(selectedSwitches()); updateButtons(); });
  }
  scope.addEventListener('change', () => { range.hidden = scope.value !== 'range'; });
  cancel.addEventListener('click', () => { api.cancel(); message('正在取消；已完成页面的结果会保留。'); });
  start.addEventListener('click', () => {
    busy = true;
    updateButtons();
    message('正在准备识别…');
    const options: RunOptions = { switches: selectedSwitches(), scope: scope.value as RunOptions['scope'], range: range.value,
      force: element<HTMLInputElement>('force').checked };
    void action(async () => {
      try {
        results = await api.run(options, value => {
          if (closed) return;
          progress.max = value.total;
          progress.value = value.done;
          message(`${value.text}（${value.done}/${value.total}）`);
        }, value => { results = value; render(); });
        render();
        message(`识别完成，共保存 ${results.length} 个结果。`);
      } finally { busy = false; if (!closed) updateButtons(); }
    });
  });
  for (const node of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    node.addEventListener('click', () => {
      filter = node.dataset.filter as Filter;
      for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button === node));
      render();
    });
  }
  exportSelect.addEventListener('change', () => {
    const format = exportSelect.value;
    exportSelect.value = '';
    if (format === 'markdown' || format === 'json') void action(() => api.exportResults(results.filter(r => filter === 'all' || r.kind === filter), format), '结果已导出');
  });

  const apiKey = element<HTMLInputElement>('api-key');
  const secretKey = element<HTMLInputElement>('secret-key');
  const credentialStatus = element('credentials-status');
  try {
    const credentials = api.getCredentials();
    apiKey.value = credentials.apiKey;
    secretKey.value = credentials.secretKey;
    if (!credentials.apiKey) element<HTMLDetailsElement>('settings').open = true;
  } catch { credentialStatus.textContent = '无法读取凭据，请解锁 Zotero 登录管理器后重试。'; }
  async function save(verify: boolean): Promise<void> {
    credentialsBusy = true;
    updateButtons();
    try {
      await api.saveCredentials({ apiKey: apiKey.value, secretKey: secretKey.value });
      if (verify) {
        credentialStatus.textContent = '正在验证…';
        await api.verify();
      }
      if (!closed) {
        credentialStatus.textContent = verify ? '百度鉴权成功。服务权限和额度会在实际识别时检查。' : '设置已保存。';
        credentialStatus.classList.remove('error');
      }
    } catch (error) {
      if (!closed) { credentialStatus.textContent = error instanceof Error ? error.message : String(error); credentialStatus.classList.add('error'); }
    } finally { credentialsBusy = false; if (!closed) updateButtons(); }
  }
  element('save-settings').addEventListener('click', () => { void save(false); });
  element('verify').addEventListener('click', () => { void save(true); });
  if (settingsOnly) {
    document.body.classList.add('settings-only');
    element('recognition-controls').hidden = true;
    element('workspace').hidden = true;
    element<HTMLDetailsElement>('settings').open = true;
    message('设置用于所有文档。');
  } else {
    void action(async () => {
      try {
        results = await api.load();
        render();
        message(results.length ? '已加载本地提取结果。' : '请选择类型和页码，开始识别。');
      } finally { loading = false; if (!closed) updateButtons(); }
    });
  }
  updateButtons();
  window.addEventListener('unload', () => { closed = true; api.cancel(); apiKey.value = secretKey.value = ''; }, { once: true });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init, { once: true });
else init();
