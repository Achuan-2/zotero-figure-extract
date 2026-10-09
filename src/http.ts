export interface HTTPRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  response: 'json' | 'text';
  body?: {
    fields: Record<string, string>;
    file: { base64: string; name: string; type: string };
  };
}
export interface HTTPTransport {
  request(options: HTTPRequest, signal: AbortSignal): Promise<unknown>;
  delay(ms: number, signal: AbortSignal): Promise<void>;
}
