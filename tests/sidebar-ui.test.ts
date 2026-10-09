import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { bindExtractionUI } from '../src/ui';
import type { ExtractionAPI, RunOptions } from '../src/contracts';
import { defaults } from '../src/domain';
import { credentialURLs, type Provider } from '../src/providers';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function fixture(overrides: Partial<ExtractionAPI> = {}) {
  const dom = new JSDOM(await readFile('addon/chrome/content/sidebar.xhtml', 'utf8'), { contentType: 'application/xhtml+xml' });
  const document = dom.window.document;
  const runs: RunOptions[] = [], links: string[] = [];
  let switches = { ...defaults }, provider: Provider = 'aistudio', cancelled = 0;
  const api: ExtractionAPI = {
    title: 'sample.pdf', pageCount: 12, currentPage: 4,
    getSwitches: () => switches, setSwitches: value => { switches = value; },
    getProvider: () => provider, setProvider: value => { provider = value; },
    getCredentials: value => ({ apiKey: value === 'baidu' ? 'cloud-key' : 'studio-key', secretKey: value === 'baidu' ? 'cloud-secret' : '' }),
    saveCredentials: async () => {}, verify: async () => {}, openExternal: url => { links.push(url); },
    load: async () => [], run: async options => { runs.push(options); return []; },
    cancel: () => { cancelled++; }, openSource: async () => {}, copyText() {}, saveImage: async () => false,
    exportResults: async () => false, annotate: async () => {}, removeResult: async () => {}, ...overrides
  };
  const dispose = bindExtractionUI(document, api);
  await settle();
  const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const change = (id: string) => node(id).dispatchEvent(new dom.window.Event('change'));
  return { dom, document, api, node, change, dispose, runs, links, cancelled: () => cancelled };
}

test('侧栏默认全部页；图表公式独立开关、当前页和指定页码传入识别任务', async () => {
  const page = await fixture();
  assert.equal(page.node<HTMLSelectElement>('scope').value, 'all');
  assert.equal(page.node<HTMLSelectElement>('provider').value, 'aistudio');
  page.node('start').click();
  await settle();
  assert.deepEqual(page.runs[0], { provider: 'aistudio', switches: defaults, scope: 'all', range: '', force: false });
  page.node<HTMLInputElement>('recognize-table').checked = false;
  page.change('recognize-table');
  page.node<HTMLSelectElement>('scope').value = 'range';
  page.change('scope');
  assert.equal(page.node('page-range').hidden, false);
  page.node<HTMLInputElement>('page-range').value = '1-5,8';
  page.node('start').click();
  await settle();
  assert.deepEqual(page.runs[1].switches, { figure: true, table: false, formula: true });
  assert.equal(page.runs[1].scope, 'range');
  assert.equal(page.runs[1].range, '1-5,8');
  page.node<HTMLSelectElement>('scope').value = 'current';
  page.change('scope');
  assert.equal(page.node('page-range').hidden, true);
  page.node('start').click();
  await settle();
  assert.equal(page.runs[2].scope, 'current');
  for (const kind of ['figure', 'formula']) {
    page.node<HTMLInputElement>(`recognize-${kind}`).checked = false;
    page.change(`recognize-${kind}`);
  }
  assert.equal(page.node<HTMLButtonElement>('start').disabled, true);
  page.node('start').click();
  assert.equal(page.runs.length, 3);
  page.dispose();
  page.dom.window.close();
});

test('侧栏获取 Key 链接随接口切换，在系统浏览器打开；AI Studio 无 Secret Key', async () => {
  const page = await fixture();
  assert.equal(page.node('secret-key-field').hidden, true);
  assert.equal(page.node<HTMLAnchorElement>('key-link').href, credentialURLs.aistudio);
  page.node('key-link').click();
  page.node<HTMLSelectElement>('provider').value = 'baidu';
  page.change('provider');
  assert.equal(page.node('secret-key-field').hidden, false);
  page.node('key-link').click();
  assert.deepEqual(page.links, [credentialURLs.aistudio, credentialURLs.baidu]);
  page.dispose();
  page.dom.window.close();
});

test('识别期间锁定接口和页码，阻止重复开始；取消与卸载保留一致的任务生命周期', async () => {
  let finish: (() => void) | undefined;
  let count = 0;
  const page = await fixture({ run: async () => { count++; await new Promise<void>(resolve => { finish = resolve; }); return []; } });
  page.node('start').click();
  page.node('start').click();
  assert.equal(count, 1);
  assert.equal(page.node<HTMLSelectElement>('scope').disabled, true);
  assert.equal(page.node<HTMLSelectElement>('provider').disabled, true);
  page.node('cancel').click();
  assert.equal(page.cancelled(), 1);
  finish!();
  await settle();
  assert.equal(page.node<HTMLSelectElement>('scope').disabled, false);
  assert.equal(page.node<HTMLButtonElement>('cancel').disabled, true);
  page.dispose();
  assert.equal(page.cancelled(), 2);
  assert.equal(page.node<HTMLInputElement>('api-key').value, '');
  page.dom.window.close();
});
