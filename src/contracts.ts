import type { Credentials } from './baidu';
import type { Kind, Result, Switches } from './domain';

export interface RunOptions {
  switches: Switches;
  scope: 'current' | 'all' | 'range';
  range: string;
  force: boolean;
}
export interface Progress { text: string; done: number; total: number }
export interface DialogAPI {
  title: string;
  pageCount: number;
  currentPage: number;
  getSwitches(): Switches;
  setSwitches(value: Switches): void;
  getCredentials(): Credentials;
  saveCredentials(value: Credentials): Promise<void>;
  verify(): Promise<void>;
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
export interface DialogArguments { api: DialogAPI; settingsOnly: boolean }
export type Filter = Kind | 'all';
