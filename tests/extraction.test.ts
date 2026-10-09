import test from 'node:test';
import assert from 'node:assert/strict';
import { BaiduClient, type Transport } from '../src/baidu';
import { defaults, type PageCache, type Result } from '../src/domain';
import { ExtractionService, type ExtractionIO } from '../src/extraction';
import type { RunOptions } from '../src/contracts';
import { page } from './fixture';

const options: RunOptions = { switches: defaults, scope: 'all', range: '', force: false };
function fixture() {
  const files = new Map<string, unknown>();
  let stamp = 'source:1';
  let submissions = 0;
  let disposed = 0;
  const transport: Transport = {
    async post(url) {
      if (url.includes('oauth')) return { access_token: 't', expires_in: 3600 };
      if (url.includes('/query')) return { result: { task_id: 'task', status: 'success', parse_result_url: 'https://example.bcebos.com/r' } };
      submissions++;
      return { result: { task_id: 'task' } };
    },
    async get() { return { pages: [page] }; },
    async delay(_ms, signal) { if (signal.aborted) throw new Error('操作已取消'); }
  };
  const io: ExtractionIO = {
    async stamp() { return stamp; },
    async read<T>(name: string) { return structuredClone(files.get(name)) as T | undefined; },
    async write(name, value) { files.set(name, structuredClone(value)); },
    async render() {
      return { base64: 'img', dispose() { disposed++; },
        crop(region) { return { ...region, image: 'data:image/png;base64,AA==', pdfRect: region.box }; } };
    }
  };
  const client = new BaiduClient(transport, () => ({ apiKey: 'key', secretKey: 'secret' }));
  return { files, io, transport, service: new ExtractionService(client, io),
    get submissions() { return submissions; }, get disposed() { return disposed; }, changeStamp() { stamp = 'source:2'; } };
}

test('全部关闭时拒绝开始，不上传页面', async () => {
  const f = fixture();
  await assert.rejects(f.service.run([0], { ...options, switches: { figure: false, table: false, formula: false } }, () => {}, () => {}), /至少开启/);
  assert.equal(f.submissions, 0);
});

test('跨类型复用解析缓存；重复运行不重复结果', async () => {
  const f = fixture();
  await f.service.run([0], options, () => {}, () => {});
  const result = await f.service.run([0], { ...options, switches: { figure: false, table: false, formula: true } }, () => {}, () => {});
  assert.equal(f.submissions, 1);
  assert.equal(result.length, 3);
  assert.equal(f.disposed, 2);
});

test('图表解析未启用的缓存在启用图时重新请求，强制重识别也重新请求', async () => {
  const f = fixture();
  await f.service.run([0], { ...options, switches: { figure: false, table: true, formula: false } }, () => {}, () => {});
  await f.service.run([0], options, () => {}, () => {});
  await f.service.run([0], { ...options, force: true }, () => {}, () => {});
  assert.equal(f.submissions, 3);
});

test('PDF 文件变化后隐藏过时结果，并重新解析', async () => {
  const f = fixture();
  await f.service.run([0], options, () => {}, () => {});
  f.changeStamp();
  assert.deepEqual(await f.service.load(), []);
  const result = await f.service.run([0], options, () => {}, () => {});
  assert.equal(f.submissions, 2);
  assert.equal(result.length, 3);
});

test('取消保留已完成页面，阻止下一页任务并释放画布', async () => {
  const f = fixture();
  await assert.rejects(f.service.run([0, 1], options, () => {}, () => f.service.cancel()), /取消/);
  const saved = await f.service.load();
  assert.equal(saved.length, 3);
  assert.equal(saved[0].pageIndex, 0);
  assert.equal(f.submissions, 1);
  assert.equal(f.disposed, 1);
});

test('API 失败保留已有结果，释放画布，并允许再次运行', async () => {
  const f = fixture();
  const before = await f.service.run([0], options, () => {}, () => {});
  const original = f.transport.get;
  f.transport.get = async () => { throw new Error('server failure'); };
  await assert.rejects(f.service.run([0], { ...options, force: true }, () => {}, () => {}), /server failure/);
  assert.deepEqual(await f.service.load(), before);
  assert.equal(f.disposed, 2);
  f.transport.get = original;
  assert.deepEqual(await f.service.run([0], options, () => {}, () => {}), before);
});

test('移除结果只更改本地结果；缓存不含凭据', async () => {
  const f = fixture();
  const before = await f.service.run([0], options, () => {}, () => {});
  await f.service.remove(before[0].id);
  assert.equal((await f.service.load()).length, 2);
  const cache = f.files.get('page-0.json') as PageCache;
  assert.equal(cache.schema, 1);
  assert.deepEqual(Object.keys(cache).sort(), ['schema', 'sourceStamp', 'chartAnalysis', 'parserKey', 'parsed'].sort());
});

test('文档并发任务被阻止，当前任务结束后可再次运行', async () => {
  const f = fixture();
  let resolve!: () => void;
  const gate = new Promise<void>(r => { resolve = r; });
  f.transport.delay = () => gate;
  const run = f.service.run([0], options, () => {}, () => {});
  await assert.rejects(f.service.run([0], options, () => {}, () => {}), /已有/);
  resolve();
  await run;
  assert.equal((await f.service.run([0], options, () => {}, () => {})).length, 3);
});

test('解析途中源 PDF 变化时不提交错误的页面结果', async () => {
  const f = fixture();
  f.transport.get = async () => { f.changeStamp(); return { pages: [page] }; };
  await assert.rejects(f.service.run([0], options, () => {}, () => {}), /发生变化/);
  assert.equal(f.files.has('results.json'), false);
  assert.equal(f.disposed, 1);
});
