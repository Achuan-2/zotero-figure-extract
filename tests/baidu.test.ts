import test from 'node:test';
import assert from 'node:assert/strict';
import { BaiduClient, TASK_URL, type Transport } from '../src/baidu';
import { page } from './fixture';

function fake(responses: unknown[]) {
  const calls: { url: string; values?: Record<string, string> }[] = [];
  const delays: number[] = [];
  const transport: Transport = {
    async post(url, values) { calls.push({ url, values }); if (!responses.length) throw new Error('Unexpected request'); return responses.shift(); },
    async get(url) { calls.push({ url }); return { pages: [page] }; },
    async delay(ms, signal) { delays.push(ms); if (signal.aborted) throw new Error('操作已取消'); }
  };
  return { calls, delays, transport, client: new BaiduClient(transport, () => ({ apiKey: 'key', secretKey: 'secret' })) };
}
const auth = { access_token: 'token', expires_in: 3600 };
const created = { error_code: 0, result: { task_id: 'task-id' } };
const success = { error_code: 0, result: { task_id: 'task-id', status: 'success', parse_result_url: 'https://example.bcebos.com/result.json' } };

test('严格使用文档规定的异步提交、状态轮询及 JSON 下载协议', async () => {
  const f = fake([auth, created,
    { result: { task_id: 'task-id', status: 'pending' } },
    { result: { task_id: 'task-id', status: 'processing' } }, success]);
  const status: string[] = [];
  assert.deepEqual(await f.client.parse('base64', true, new AbortController().signal, s => status.push(s)), page);
  assert.equal(f.calls[1].url, TASK_URL + '?access_token=token');
  assert.deepEqual(f.calls[1].values, {
    file_data: 'base64', file_name: 'page.png', analysis_chart: 'true', angle_adjust: 'false',
    unwarp: 'false', erase_watermark: 'false', erase_seal: 'false', merge_tables: 'false'
  });
  assert.deepEqual(f.calls[2].values, { task_id: 'task-id' });
  assert.equal(f.calls.at(-1)!.url, 'https://example.bcebos.com/result.json');
  assert.deepEqual(f.delays, [5000, 5000, 5000]);
  assert.equal(status.length, 2);
});

test('关闭图识别时关闭统计图解析，不发送虚构的 table/formula 参数', async () => {
  const f = fake([auth, created, success]);
  await f.client.parse('data', false, new AbortController().signal, () => {});
  assert.equal(f.calls[1].values!.analysis_chart, 'false');
  assert.equal(f.calls[1].values!.recognize_formula, undefined);
});

test('过期 token 刷新一次后重试，避免无限重试', async () => {
  const f = fake([auth, { error_code: 110 }, { access_token: 'fresh', expires_in: 3600 }, created, success]);
  await f.client.parse('data', true, new AbortController().signal, () => {});
  assert.equal(f.calls[3].url, TASK_URL + '?access_token=fresh');
  const failed = fake([auth, { error_code: 110 }, auth, { error_code: 111, error_msg: 'invalid' }]);
  await assert.rejects(failed.client.parse('data', true, new AbortController().signal, () => {}), /111/);
  assert.equal(failed.calls.length, 4);
});

test('鉴权失败、额度错误和异步任务失败均给出明确错误', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(fake([{ error: 'invalid_client' }]).client.verify(signal), /鉴权失败/);
  await assert.rejects(fake([auth, { error_code: 17, error_msg: 'quota' }]).client.parse('x', true, signal, () => {}), /17/);
  await assert.rejects(fake([auth, created, { result: { task_id: 'task-id', status: 'failed', task_error: 'quota exhausted' } }]).client.parse('x', true, signal, () => {}), /quota exhausted/);
});

test('取消后不再查询，也不下载识别结果', async () => {
  const f = fake([auth, created, success]);
  const controller = new AbortController();
  f.transport.delay = async () => { controller.abort(); throw new Error('操作已取消'); };
  await assert.rejects(f.client.parse('x', true, controller.signal, () => {}), /取消/);
  assert.equal(f.calls.length, 2);
});

test('拒绝不安全链接、未知状态和非单页结果', async () => {
  const signal = new AbortController().signal;
  const invalid = fake([auth, created, { result: { task_id: 't', status: 'success', parse_result_url: 'http://example.com' } }]);
  await assert.rejects(invalid.client.parse('x', true, signal, () => {}), /链接/);
  await assert.rejects(fake([auth, created, { result: { task_id: 't', status: 'wat' } }]).client.parse('x', true, signal, () => {}), /未知/);
  const multipage = fake([auth, created, success]);
  multipage.transport.get = async () => ({ pages: [page, page] });
  await assert.rejects(multipage.client.parse('x', true, signal, () => {}), /单页/);
});

test('凭据缺失时不访问网络，鉴权缓存随凭据改变而失效', async () => {
  const f = fake([auth, auth]);
  let apiKey = 'key';
  const client = new BaiduClient(f.transport, () => ({ apiKey, secretKey: 'secret' }));
  const signal = new AbortController().signal;
  await client.verify(signal);
  await client.verify(signal);
  assert.equal(f.calls.length, 1);
  apiKey = 'new-key';
  await client.verify(signal);
  assert.equal(f.calls.length, 2);
  apiKey = '';
  await assert.rejects(client.verify(signal), /填写/);
  assert.equal(f.calls.length, 2);
});
