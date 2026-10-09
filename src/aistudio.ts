import { abortIfNeeded, type ParsedPage } from './domain';
import type { HTTPTransport } from './http';
import { cacheKeys } from './providers';

export const AI_STUDIO_JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
export const AI_STUDIO_MODEL = 'PaddleOCR-VL-1.6';
interface JobResponse {
  code?: number;
  msg?: string;
  data?: { jobId?: string; state?: string; errorMsg?: string; resultUrl?: { jsonUrl?: string } };
}
interface Block {
  block_id?: number | string;
  block_label: string;
  block_bbox: number[];
  block_content?: string;
}
interface StudioPage {
  prunedResult?: {
    width?: number | number[];
    height?: number | number[];
    parsing_res_list?: Block[];
    doc_preprocessor_res?: { angle?: number; model_settings?: { use_doc_unwarping?: boolean } };
  };
}

/** Convert PaddleX's xyxy blocks to the common xywh page used for local crops. */
export function parseAIStudioResult(jsonl: string): ParsedPage {
  let pages: StudioPage[];
  try {
    const lines = jsonl.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(line => line.trim());
    pages = lines.flatMap(line => {
      const value = JSON.parse(line) as { result?: { layoutParsingResults?: StudioPage[] } };
      if (!Array.isArray(value.result?.layoutParsingResults)) throw new Error('缺少版面结果');
      return value.result.layoutParsingResults;
    });
  } catch { throw new Error('AI Studio 返回的 JSONL 结果格式不正确'); }
  if (pages.length !== 1) throw new Error('AI Studio 单页识别返回了非单页结果');
  const data = pages[0].prunedResult;
  const dimension = (value: number | number[] | undefined) => Array.isArray(value) && value.length === 1 ? value[0] : value;
  const width = dimension(data?.width), height = dimension(data?.height);
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0 || !Array.isArray(data?.parsing_res_list)) {
    throw new Error('AI Studio 返回的页面缺少有效尺寸或版面坐标');
  }
  const preprocessing = data.doc_preprocessor_res;
  const angle = preprocessing?.angle;
  if ((angle !== undefined && angle !== -1 && angle % 360 !== 0) || preprocessing?.model_settings?.use_doc_unwarping) {
    throw new Error('AI Studio 矫正了页面，无法可靠匹配原文坐标');
  }
  return {
    page_num: 0,
    meta: { page_width: width, page_height: height },
    layouts: data.parsing_res_list.map((block, index) => {
      const bbox = block.block_bbox;
      const valid = Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite);
      return {
        layout_id: `aistudio-${block.block_id ?? index}`,
        type: block.block_label,
        text: typeof block.block_content === 'string' ? block.block_content : '',
        position: valid ? [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]] : []
      };
    })
  };
}

export class AIStudioClient {
  readonly provider = 'aistudio' as const;
  readonly cacheKey = cacheKeys.aistudio;
  readonly model = AI_STUDIO_MODEL;
  constructor(private transport: HTTPTransport, private credentials: () => { apiKey: string }) {}

  private headers(): Record<string, string> {
    const key = this.credentials().apiKey.trim();
    if (!key) throw new Error('请先填写 AI Studio API Key / Access Token');
    return { Authorization: `Bearer ${key}` };
  }
  private check(response: unknown): JobResponse {
    const value = response as JobResponse;
    if (!value || value.code !== 0) {
      // The server can include arbitrary text. Do not expose the submitted key.
      const detail = this.redact(value?.msg ?? '请求失败');
      throw new Error(`AI Studio 错误 ${value?.code ?? '未知'}：${detail}`);
    }
    return value;
  }
  private redact(message: string): string {
    const key = this.credentials().apiKey.trim();
    return key ? String(message).replaceAll(key, '[已隐藏]') : String(message);
  }
  async verify(signal: AbortSignal): Promise<void> {
    // A documented read-only endpoint using an unused local batch identifier.
    // Authentication checks never submit an OCR job or upload a document.
    this.check(await this.transport.request({ method: 'GET', url: `${AI_STUDIO_JOB_URL}/batch/figureextract-verify-${Date.now()}`,
      headers: this.headers(), response: 'json' }, signal));
  }
  async parse(base64: string, chartAnalysis: boolean, signal: AbortSignal, onStatus: (status: string) => void): Promise<ParsedPage> {
    abortIfNeeded(signal);
    const headers = this.headers();
    const created = this.check(await this.transport.request({
      method: 'POST', url: AI_STUDIO_JOB_URL, headers, response: 'json',
      body: {
        fields: { model: AI_STUDIO_MODEL, optionalPayload: JSON.stringify({
          useDocOrientationClassify: false, useDocUnwarping: false,
          useLayoutDetection: true, useChartRecognition: chartAnalysis, visualize: false
        }) },
        file: { base64, name: 'page.png', type: 'image/png' }
      }
    }, signal));
    const jobID = created.data?.jobId;
    if (!jobID) throw new Error('AI Studio 未返回任务 ID');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await this.transport.delay(5000, signal);
      abortIfNeeded(signal);
      const task = this.check(await this.transport.request({ method: 'GET', url: `${AI_STUDIO_JOB_URL}/${encodeURIComponent(jobID)}`,
        headers, response: 'json' }, signal)).data;
      if (task?.state === 'failed') throw new Error(`AI Studio 解析失败：${this.redact(task.errorMsg ?? '请检查服务权限和额度')}`);
      if (task?.state === 'done') {
        const url = task.resultUrl?.jsonUrl;
        if (!url || !/^https:\/\//.test(url)) throw new Error('AI Studio 未返回安全的结果链接');
        // Signed result URLs need no bearer token; do not forward credentials.
        const result = await this.transport.request({ method: 'GET', url, response: 'text' }, signal);
        abortIfNeeded(signal);
        if (typeof result !== 'string') throw new Error('AI Studio 未返回 JSONL 文本');
        return parseAIStudioResult(result);
      }
      if (!['pending', 'running'].includes(task?.state ?? '')) throw new Error(`AI Studio 返回未知任务状态：${task?.state}`);
      onStatus(task?.state === 'pending' ? 'AI Studio 任务排队中' : 'PaddleOCR-VL 1.6 解析中');
    }
    throw new Error('AI Studio 任务超过 10 分钟未完成，请稍后重试');
  }
}
