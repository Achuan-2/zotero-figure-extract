import type { Credentials } from './baidu';
import type { Kind, Result, Switches } from './domain';
import type { Provider } from './providers';

export interface CredentialSettingsAPI {
  getProvider(): Provider;
  setProvider(value: Provider): void;
  getCredentials(provider?: Provider): Credentials;
  saveCredentials(value: Credentials, provider?: Provider): Promise<void>;
  verify(provider: Provider, signal: AbortSignal): Promise<void>;
  openExternal(url: string): void;
}

export interface RunOptions {
  provider?: Provider;
  switches: Switches;
  scope: 'current' | 'all' | 'range';
  range: string;
  force: boolean;
}
export interface Progress { text: string; done: number; total: number }
export interface ExtractionAPI extends CredentialSettingsAPI {
  title: string;
  pageCount: number;
  currentPage: number;
  getSwitches(): Switches;
  setSwitches(value: Switches): void;
  load(): Promise<Result[]>;
  run(options: RunOptions, progress: (value: Progress) => void, update: (results: Result[]) => void): Promise<Result[]>;
  cancel(): void;
  openSource(result: Result): Promise<void>;
  copyText(text: string): void;
  saveImage(result: Result): Promise<boolean>;
  exportResults(results: Result[], format: 'markdown' | 'json'): Promise<boolean>;
  annotate(result: Result): Promise<void>;
  removeResult(id: string): Promise<void>;
}
export type Filter = Kind | 'all';
