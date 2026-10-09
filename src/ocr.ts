import { BaiduClient, type Credentials, type Transport } from './baidu';
import { AIStudioClient } from './aistudio';
import type { HTTPTransport } from './http';
import type { Provider } from './providers';
import type { ParsedPage } from './domain';

export interface PageParser {
  readonly cacheKey?: string;
  readonly provider?: Provider;
  readonly model?: string;
  snapshot?(provider?: Provider): PageParser;
  parse(base64: string, chartAnalysis: boolean, signal: AbortSignal, onStatus: (status: string) => void): Promise<ParsedPage>;
}
type Client = BaiduClient | AIStudioClient;

/** Sessions pin both provider and credentials for the duration of a PDF task. */
export class OCRClient implements PageParser {
  private clients = new Map<Provider, { identity: string; client: Client }>();
  constructor(private transport: Transport & HTTPTransport, private selectedProvider: () => Provider,
    private credentials: (provider: Provider) => Credentials) {}
  private forProvider(provider: Provider): Client {
    const credentials = { ...this.credentials(provider) };
    const identity = JSON.stringify(credentials);
    const previous = this.clients.get(provider);
    if (previous?.identity === identity) return previous.client;
    const client = provider === 'baidu' ? new BaiduClient(this.transport, () => credentials)
      : new AIStudioClient(this.transport, () => credentials);
    this.clients.set(provider, { identity, client });
    return client;
  }
  snapshot(provider: Provider = this.selectedProvider()): Client { return this.forProvider(provider); }
  parse(base64: string, chartAnalysis: boolean, signal: AbortSignal, onStatus: (status: string) => void): Promise<ParsedPage> {
    return this.snapshot().parse(base64, chartAnalysis, signal, onStatus);
  }
  verify(provider: Provider, signal: AbortSignal): Promise<void> { return this.forProvider(provider).verify(signal); }
  clearToken(): void {
    for (const { client } of this.clients.values()) if (client instanceof BaiduClient) client.clearToken();
    this.clients.clear();
  }
}
