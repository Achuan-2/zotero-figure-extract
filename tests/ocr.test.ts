import test from 'node:test';
import assert from 'node:assert/strict';
import { OCRClient } from '../src/ocr';
import { ExtractionService, type ExtractionIO } from '../src/extraction';
import { defaults, type PageCache } from '../src/domain';
import { cacheKeys, type Provider } from '../src/providers';
import type { Transport, Credentials } from '../src/baidu';
import type { HTTPRequest, HTTPTransport } from '../src/http';
import { page } from './fixture';
import { jsonl } from './aistudio-fixture';

function fixture() {
  let provider: Provider = 'baidu';
  const credentials: Record<Provider, Credentials> = {
    baidu: { apiKey: 'cloud-key', secretKey: 'cloud-secret' }, aistudio: { apiKey: 'studio-key', secretKey: '' }
  };
  const submissions = { baidu: 0, aistudio: 0 };
  const studioCalls: HTTPRequest[] = [];
  const cloudCalls: { url: string; values: Record<string, string> }[] = [];
  const transport: Transport & HTTPTransport = {
    async post(url, values) {
      cloudCalls.push({ url, values });
      if (url.includes('oauth')) return { access_token: 'cloud-token', expires_in: 3600 };
      if (url.endsWith('access_token=cloud-token') && url.includes('/query')) {
        return { result: { status: 'success', parse_result_url: 'https://cloud.bcebos.com/r' } };
      }
      submissions.baidu++;
      return { result: { task_id: 'cloud-job' } };
    },
    async get() { return { pages: [page] }; },
    async delay() {},
    async request(options) {
      studioCalls.push(options);
      if (options.response === 'text') return jsonl;
      if (options.method === 'POST') { submissions.aistudio++; return { code: 0, data: { jobId: 'studio-job' } }; }
      return { code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://studio.bcebos.com/r' } } };
    }
  };
  const client = new OCRClient(transport, () => provider, value => credentials[value]);
  const files = new Map<string, unknown>();
  const io: ExtractionIO = {
    async stamp() { return 'unchanged-source'; },
    async read<T>(name: string) { return structuredClone(files.get(name)) as T | undefined; },
    async write(name, value) { files.set(name, structuredClone(value)); },
    async render() { return { base64: 'YWJj', dispose() {}, crop: region => ({ ...region, pdfRect: region.box, image: 'data:image/png;base64,AA==' }) }; }
  };
  return { client, credentials, submissions, studioCalls, cloudCalls, files, service: new ExtractionService(client, io),
    select: (value: Provider) => { provider = value; } };
}
const options = { switches: defaults, scope: 'all' as const, range: '', force: false };

test('切换接口分别调用正确服务，缓存不串用；切回原接口复用缓存并兼容旧百度缓存', async () => {
  const f = fixture();
  await f.service.run([0], options, () => {}, () => {});
  // v0.1.2 caches had no parserKey; they are specifically Baidu caches.
  delete (f.files.get('page-0.json') as PageCache).parserKey;
  f.select('aistudio');
  const result = await f.service.run([0], options, () => {}, () => {});
  assert.equal(result[0].provider, 'aistudio');
  assert.equal(result[0].model, 'PaddleOCR-VL-1.6');
  assert.equal((f.files.get('page-0-aistudio.json') as PageCache).parserKey, cacheKeys.aistudio);
  f.select('baidu');
  await f.service.run([0], options, () => {}, () => {});
  assert.deepEqual(f.submissions, { baidu: 1, aistudio: 1 });
  f.select('aistudio');
  await f.service.run([0], options, () => {}, () => {});
  assert.deepEqual(f.submissions, { baidu: 1, aistudio: 1 });
  assert.doesNotMatch(JSON.stringify([...f.files.values()]), /cloud-key|cloud-secret|studio-key/);
});

test('多页任务中切换全局接口或改凭据，不改变已开始任务的服务与凭据', async () => {
  const f = fixture();
  await f.service.run([0, 1], options, () => {}, () => {
    f.select('aistudio');
    f.credentials.baidu.apiKey = 'new-cloud-key';
  });
  assert.deepEqual(f.submissions, { baidu: 2, aistudio: 0 });
  assert.equal(f.cloudCalls.find(call => call.url.includes('oauth'))?.values.client_id, 'cloud-key');
  f.select('aistudio');
  const pinned = f.client.snapshot();
  f.credentials.aistudio.apiKey = 'new-studio-key';
  await pinned.parse('YWJj', true, new AbortController().signal, () => {});
  assert.equal(f.studioCalls[0].headers?.Authorization, 'Bearer studio-key');
  await f.client.snapshot().parse('YWJj', true, new AbortController().signal, () => {});
  assert.equal(f.studioCalls.filter(call => call.method === 'POST')[1].headers?.Authorization, 'Bearer new-studio-key');
});

test('提取窗口显式选择的接口优先于其他设置窗口随后改变的默认接口', async () => {
  const f = fixture();
  await f.service.run([0], { ...options, provider: 'aistudio' }, () => {}, () => {});
  assert.deepEqual(f.submissions, { baidu: 0, aistudio: 1 });
});
