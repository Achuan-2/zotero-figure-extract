import { abortIfNeeded, type ParsedPage } from './domain';
import { cacheKeys } from './providers';

export interface Credentials { apiKey: string; secretKey: string }
export interface Transport {
  post(url: string, values: Record<string, string>, signal: AbortSignal): Promise<unknown>;
  get(url: string, signal: AbortSignal): Promise<unknown>;
  delay(ms: number, signal: AbortSignal): Promise<void>;
}
interface ApiResponse {
  error_code?: number;
  error_msg?: string;
  error?: string;
  error_description?: string;
  access_token?: string;
  expires_in?: number;
  result?: { task_id: string; status?: string; task_error?: string; parse_result_url?: string };
}
export const TASK_URL = 'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task';

export class BaiduClient {
  readonly provider = 'baidu' as const;
  readonly cacheKey = cacheKeys.baidu;
  readonly model = 'PaddleOCR-VL (Baidu managed)';
  private token?: { value: string; expires: number; identity: string };
  constructor(private transport: Transport, private credentials: () => Credentials) {}

  clearToken(): void { this.token = undefined; }

  async verify(signal: AbortSignal): Promise<void> { await this.getToken(signal); }

  private async getToken(signal: AbortSignal): Promise<string> {
    const { apiKey, secretKey } = this.credentials();
    if (!apiKey.trim() || !secretKey.trim()) throw new Error('请先在设置中填写百度 API Key 和 Secret Key');
    const identity = apiKey + '\n' + secretKey;
    if (this.token?.identity === identity && this.token.expires > Date.now()) return this.token.value;
    const response = await this.transport.post('https://aip.baidubce.com/oauth/2.0/token', {
      grant_type: 'client_credentials', client_id: apiKey.trim(), client_secret: secretKey.trim()
    }, signal) as ApiResponse;
    if (!response.access_token || response.error) throw new Error('百度鉴权失败，请检查 API Key 和 Secret Key');
    this.token = { value: response.access_token, identity, expires: Date.now() + Math.max(0, (response.expires_in ?? 0) - 60) * 1000 };
    return response.access_token;
  }

  private async api(url: string, values: Record<string, string>, signal: AbortSignal, retry = true): Promise<ApiResponse> {
    const token = await this.getToken(signal);
    const response = await this.transport.post(`${url}?access_token=${encodeURIComponent(token)}`, values, signal) as ApiResponse;
    if ([110, 111].includes(response.error_code ?? 0) && retry) {
      this.clearToken();
      return this.api(url, values, signal, false);
    }
    if (response.error_code) throw new Error(`百度 OCR 错误 ${response.error_code}：${response.error_msg ?? '请求失败'}`);
    return response;
  }

  async parse(base64: string, chartAnalysis: boolean, signal: AbortSignal, onStatus: (status: string) => void): Promise<ParsedPage> {
    abortIfNeeded(signal);
    const created = await this.api(TASK_URL, {
      file_data: base64, file_name: 'page.png', analysis_chart: String(chartAnalysis),
      // Keep coordinates aligned with the page rendered locally.
      angle_adjust: 'false', unwarp: 'false', erase_watermark: 'false', erase_seal: 'false',
      merge_tables: 'false'
    }, signal);
    const taskID = created.result?.task_id;
    if (!taskID) throw new Error('百度未返回任务 ID');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await this.transport.delay(5000, signal);
      const response = await this.api(TASK_URL + '/query', { task_id: taskID }, signal);
      const task = response.result;
      if (!task) throw new Error('百度未返回任务状态');
      if (task.status === 'failed') throw new Error(`百度解析失败：${task.task_error ?? '请检查服务权限和额度'}`);
      if (task.status === 'success') {
        if (!task.parse_result_url || !/^https:\/\//.test(task.parse_result_url)) throw new Error('百度未返回有效的解析结果链接');
        const parsed = await this.transport.get(task.parse_result_url, signal) as { pages?: ParsedPage[] };
        if (!Array.isArray(parsed.pages) || parsed.pages.length !== 1) throw new Error('单页识别结果格式不正确');
        abortIfNeeded(signal);
        return parsed.pages[0];
      }
      if (!['pending', 'processing'].includes(task.status ?? '')) throw new Error(`未知的百度任务状态：${task.status}`);
      onStatus(task.status === 'pending' ? '百度任务排队中' : 'PaddleOCR-VL 1.6 解析中');
    }
    throw new Error('百度任务超过 10 分钟未完成，请稍后重试');
  }
}
