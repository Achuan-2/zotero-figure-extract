import type { PageParser } from './ocr';
import { cacheKeys } from './providers';
import { abortIfNeeded, enabledKinds, mergeResults, normalizePage, type PageCache, type Result } from './domain';
import type { Progress, RunOptions } from './contracts';

export interface ExtractionIO {
  stamp(): Promise<string>;
  read<T>(name: string): Promise<T | undefined>;
  write(name: string, data: unknown): Promise<void>;
  render(pageIndex: number, signal: AbortSignal): Promise<{
    base64: string;
    crop: (region: ReturnType<typeof normalizePage>[number], width: number, height: number) => Result;
    dispose(): void;
  }>;
}
interface Manifest { schema: 1; sourceStamp: string; results: Result[] }

export class ExtractionService {
  private controller?: AbortController;
  constructor(private client: PageParser, private io: ExtractionIO) {}
  cancel(): void { this.controller?.abort(); }

  async load(): Promise<Result[]> {
    const manifest = await this.io.read<Manifest>('results.json');
    if (!manifest) return [];
    if (manifest.schema !== 1 || !Array.isArray(manifest.results)) throw new Error('本地提取结果版本或格式不正确');
    return manifest.sourceStamp === await this.io.stamp() ? manifest.results : [];
  }

  async remove(id: string): Promise<void> {
    if (this.controller) throw new Error('识别进行中，请完成后再删除结果');
    const results = (await this.load()).filter(result => result.id !== id);
    await this.io.write('results.json', { schema: 1, sourceStamp: await this.io.stamp(), results });
  }

  async run(pages: number[], options: RunOptions, progress: (value: Progress) => void, update: (results: Result[]) => void): Promise<Result[]> {
    if (this.controller) throw new Error('当前文档已有识别任务');
    if (!enabledKinds(options.switches).length) throw new Error('请至少开启图、表、公式中的一种');
    if (!pages.length) throw new Error('没有要识别的页面');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    try {
      const parser = this.client.snapshot?.(options.provider) ?? this.client;
      const parserKey = parser.cacheKey ?? cacheKeys.baidu;
      const sourceStamp = await this.io.stamp();
      let results = await this.load();
      const total = pages.length;
      for (let index = 0; index < pages.length; index++) {
        abortIfNeeded(signal);
        const pageIndex = pages[index];
        const report = (text: string) => progress({ text: `第 ${pageIndex + 1} 页：${text}`, done: index, total });
        report('准备页面');
        const cacheName = parser.provider === 'aistudio' ? `page-${pageIndex}-aistudio.json` : `page-${pageIndex}.json`;
        const cached = options.force ? undefined : await this.io.read<PageCache>(cacheName);
        const reusable = cached?.schema === 1 && cached.sourceStamp === sourceStamp
          && (cached.parserKey ?? cacheKeys.baidu) === parserKey
          && (!options.switches.figure || cached.chartAnalysis);
        const rendered = await this.io.render(pageIndex, signal);
        try {
          report(reusable ? '复用本地解析缓存' : `提交${parser.provider === 'aistudio' ? ' AI Studio ' : '百度智能云'}解析任务`);
          const parsed = reusable ? cached.parsed : await parser.parse(rendered.base64, options.switches.figure, signal, report);
          const regions = normalizePage(parsed, pageIndex, options.switches);
          abortIfNeeded(signal);
          if (!reusable) await this.io.write(cacheName, {
            schema: 1, sourceStamp, chartAnalysis: options.switches.figure, parserKey, parsed
          } satisfies PageCache);
          const replacement: Result[] = [];
          for (const region of regions) {
            abortIfNeeded(signal);
            replacement.push({ ...rendered.crop(region, parsed.meta.page_width, parsed.meta.page_height),
              provider: parser.provider, model: parser.model });
          }
          abortIfNeeded(signal);
          if (await this.io.stamp() !== sourceStamp) throw new Error('识别过程中 PDF 文件发生变化，请重新识别');
          const next = mergeResults(results, replacement, pageIndex, options.switches);
          // Commit only a completely processed page; earlier pages survive failure/cancellation.
          await this.io.write('results.json', { schema: 1, sourceStamp, results: next } satisfies Manifest);
          results = next;
          update(results);
          progress({ text: `第 ${pageIndex + 1} 页完成，提取 ${replacement.length} 个结果`, done: index + 1, total });
        } finally { rendered.dispose(); }
      }
      return results;
    } finally { this.controller = undefined; }
  }
}
