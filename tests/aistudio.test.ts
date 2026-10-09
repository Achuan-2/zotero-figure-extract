import test from 'node:test';
import assert from 'node:assert/strict';
import { AIStudioClient, AI_STUDIO_JOB_URL, parseAIStudioResult } from '../src/aistudio';
import { normalizePage, defaults } from '../src/domain';
import type { HTTPRequest, HTTPTransport } from '../src/http';
import { studioPage, jsonl } from './aistudio-fixture';

function fixture(responses: unknown[] = [
  { code: 0, data: { jobId: 'job/1' } },
  { code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://result.bcebos.com/page.jsonl' } } }
]) {
  const calls: HTTPRequest[] = [];
  const transport: HTTPTransport = {
    async request(options, signal) {
      if (signal.aborted) throw new Error('操作已取消');
      calls.push(options);
      return options.response === 'text' ? jsonl : responses.shift();
    },
    async delay(_ms, signal) { if (signal.aborted) throw new Error('操作已取消'); }
  };
  const client = new AIStudioClient(transport, () => ({ apiKey: 'studio-token' }));
  return { calls, transport, client };
}

test('AI Studio 使用 Bearer 单 Key 上传 PNG、查询任务并下载 JSONL；结果下载不传凭据', async () => {
  const f = fixture();
  const page = await f.client.parse('YWJj', true, new AbortController().signal, () => {});
  assert.equal(f.calls[0].url, AI_STUDIO_JOB_URL);
  assert.equal(f.calls[0].headers?.Authorization, 'Bearer studio-token');
  assert.equal(f.calls[0].body?.file.name, 'page.png');
  assert.equal(f.calls[0].body?.fields.model, 'PaddleOCR-VL-1.6');
  assert.deepEqual(JSON.parse(f.calls[0].body!.fields.optionalPayload), {
    useDocOrientationClassify: false, useDocUnwarping: false,
    useLayoutDetection: true, useChartRecognition: true, visualize: false
  });
  assert.equal(f.calls[1].method, 'GET');
  assert.equal(f.calls[1].url, AI_STUDIO_JOB_URL + '/job%2F1');
  assert.equal(f.calls[2].headers, undefined);
  assert.equal(f.calls[2].response, 'text');
  const regions = normalizePage(page, 0, defaults);
  assert.equal(regions.length, 3);
  assert.deepEqual(regions[0].box, [100, 200, 500, 400]);
  assert.equal(regions[1].content, studioPage.parsing_res_list[1].block_content);
  assert.equal(regions[2].content, 'E=mc^2');
});

test('AI Studio 验证走只读批次查询，不上传文件；没有 Key 时不请求网络', async () => {
  const f = fixture([{ code: 0, data: { extractResult: [] } }]);
  await f.client.verify(new AbortController().signal);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'GET');
  assert.match(f.calls[0].url, /\/jobs\/batch\/figureextract-verify-/);
  assert.equal(f.calls[0].body, undefined);
  await assert.rejects(new AIStudioClient(f.transport, () => ({ apiKey: '' })).verify(new AbortController().signal), /请先填写/);
  assert.equal(f.calls.length, 1);
});

test('AI Studio 轮询状态、图解析参数和取消均遵守接口协议', async () => {
  const f = fixture([
    { code: 0, data: { jobId: 'job' } },
    { code: 0, data: { state: 'pending' } },
    { code: 0, data: { state: 'running' } },
    { code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://result.bcebos.com/p' } } }
  ]);
  const status: string[] = [];
  await f.client.parse('YWJj', false, new AbortController().signal, value => status.push(value));
  assert.equal(status.length, 2);
  assert.equal(JSON.parse(f.calls[0].body!.fields.optionalPayload).useChartRecognition, false);
  const cancelled = fixture();
  const controller = new AbortController();
  cancelled.transport.delay = async () => { controller.abort(); };
  await assert.rejects(cancelled.client.parse('YWJj', true, controller.signal, () => {}), /取消/);
  assert.equal(cancelled.calls.length, 1);
});

test('AI Studio API 错误、失败任务与未知状态明确报错，不泄露 Key，也不盲目重新提交', async () => {
  const invalid = fixture([{ code: 401, msg: 'invalid studio-token' }]);
  const error = await invalid.client.verify(new AbortController().signal).then(() => '', (error: Error) => error.message);
  assert.match(error, /401/);
  assert.doesNotMatch(error, /studio-token/);
  assert.equal(invalid.calls.length, 1);
  for (const state of ['failed', 'unknown']) {
    const f = fixture([{ code: 0, data: { jobId: 'j' } }, { code: 0, data: { state, errorMsg: 'quota exhausted' } }]);
    await assert.rejects(f.client.parse('YWJj', true, new AbortController().signal, () => {}), state === 'failed' ? /quota exhausted/ : /未知/);
    assert.equal(f.calls.length, 2);
  }
  const unsafe = fixture([{ code: 0, data: { jobId: 'j' } }, { code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'http://unsafe.test/p' } } }]);
  await assert.rejects(unsafe.client.parse('YWJj', true, new AbortController().signal, () => {}), /安全/);
  assert.equal(unsafe.calls.length, 2);
});

test('AI Studio 拒绝不完整结果、多页 JSONL 以及坐标被矫正的页面', () => {
  assert.throws(() => parseAIStudioResult('not-json'), /JSONL/);
  assert.throws(() => parseAIStudioResult(jsonl + '\n' + jsonl), /非单页/);
  const wrap = (page: unknown) => JSON.stringify({ result: { layoutParsingResults: [{ prunedResult: page }] } });
  assert.throws(() => parseAIStudioResult(wrap({ ...studioPage, width: undefined })), /尺寸/);
  assert.throws(() => parseAIStudioResult(wrap({ ...studioPage, doc_preprocessor_res: { angle: 90 } })), /矫正/);
  assert.throws(() => parseAIStudioResult(wrap({ ...studioPage, doc_preprocessor_res: { model_settings: { use_doc_unwarping: true } } })), /矫正/);
  assert.deepEqual(normalizePage(parseAIStudioResult('\uFEFF' + jsonl + '\r\n'), 0, { figure: false, table: true, formula: false }).map(value => value.kind), ['table']);
});
