import test from 'node:test';
import assert from 'node:assert/strict';
import type { Region } from '../src/domain';
import type { RenderedPage } from '../src/platform';

Object.assign(globalThis, { Zotero: {}, Services: {}, Components: {}, IOUtils: {}, PathUtils: {} });

test('裁图按 API 页面比例映射，在四种 PDF 旋转下都生成正确的原文矩形', async () => {
  const { cropRegion } = await import('../src/platform');
  const cases = [
    { width: 600, height: 800, transform: (x: number, y: number) => [x / 4, 800 - y / 4], expected: [60, 400, 300, 720] },
    { width: 800, height: 600, transform: (x: number, y: number) => [y / 4, x / 4], expected: [60, 80, 300, 400] },
    { width: 600, height: 800, transform: (x: number, y: number) => [600 - x / 4, y / 4], expected: [300, 80, 540, 400] },
    { width: 800, height: 600, transform: (x: number, y: number) => [600 - y / 4, 800 - x / 4], expected: [300, 400, 540, 720] }
  ];
  for (const c of cases) {
    const crop = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/png;base64,AA==' };
    const rendered = {
      canvas: { width: c.width * 4, height: c.height * 4, ownerDocument: { createElementNS: () => crop } },
      viewport: { width: c.width * 4, height: c.height * 4, convertToPdfPoint: c.transform },
      base64: '', dispose() {}
    } as unknown as RenderedPage;
    const region: Region = { id: 'x', kind: 'figure', pageIndex: 0, box: [c.width * .1, c.height * .1, c.width * .5, c.height * .5], content: '', caption: '' };
    const result = cropRegion(rendered, region, c.width, c.height);
    assert.deepEqual(result.pdfRect, c.expected);
    assert.equal(crop.width, 0);
    assert.equal(crop.height, 0);
  }
});

test('比例不一致时拒绝裁图，避免错位结果', async () => {
  const { cropRegion } = await import('../src/platform');
  const rendered = { canvas: { width: 600, height: 800 }, viewport: {} } as unknown as RenderedPage;
  const region: Region = { id: 'x', kind: 'figure', pageIndex: 0, box: [0, 0, 10, 10], content: '', caption: '' };
  assert.throws(() => cropRegion(rendered, region, 800, 600), /比例/);
});

test('直接 XHR 正确编码请求体，取消会终止活动请求', async () => {
  const { makeTransport } = await import('../src/platform');
  const calls: { body?: string; headers: Record<string, string>; aborted: boolean; xhr: any }[] = [];
  class FakeXHR {
    response = { ok: true };
    status = 200;
    onload?: () => void;
    onabort?: () => void;
    entry = { body: undefined as string | undefined, headers: {} as Record<string, string>, aborted: false, xhr: this };
    constructor() { calls.push(this.entry); }
    open() {}
    setRequestHeader(key: string, value: string) { this.entry.headers[key] = value; }
    send(body: string) { this.entry.body = body; }
    abort() { this.entry.aborted = true; this.onabort?.(); }
  }
  Object.assign((globalThis as any).Zotero, { getMainWindow: () => ({ XMLHttpRequest: FakeXHR }) });
  const transport = makeTransport();
  const completed = transport.post('https://example.com', { file_data: 'a+b/c=', client_secret: 'secret&value' }, new AbortController().signal);
  assert.equal(calls[0].body, 'file_data=a%2Bb%2Fc%3D&client_secret=secret%26value');
  calls[0].xhr.onload();
  assert.deepEqual(await completed, { ok: true });
  const controller = new AbortController();
  const cancelled = transport.get('https://example.com', controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /取消/);
  assert.equal(calls[1].aborted, true);
});
