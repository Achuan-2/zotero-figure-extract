export type Provider = 'baidu' | 'aistudio';
export const defaultProvider: Provider = 'aistudio';
export const credentialURLs: Record<Provider, string> = {
  aistudio: 'https://aistudio.baidu.com/account/accessToken',
  baidu: 'https://console.bce.baidu.com/ai-engine/ocr/overview/index'
};
export const providerLabels: Record<Provider, string> = {
  baidu: '百度智能云（API Key + Secret Key）',
  aistudio: 'AI Studio（单 API Key）'
};
export const cacheKeys: Record<Provider, string> = {
  baidu: 'baidu:paddle-vl',
  aistudio: 'aistudio:PaddleOCR-VL-1.6'
};
export function isProvider(value: unknown): value is Provider {
  return value === 'baidu' || value === 'aistudio';
}
