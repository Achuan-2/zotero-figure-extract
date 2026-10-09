export type Kind = 'figure' | 'table' | 'formula';
export type Rect = [number, number, number, number];
export type Switches = Record<Kind, boolean>;
export const labels: Record<Kind, string> = { figure: '图', table: '表', formula: '公式' };
export const defaults: Switches = { figure: true, table: true, formula: true };

export interface Layout {
  layout_id: string;
  type: string;
  position: number[];
  text?: string;
}
export interface ParsedPage {
  page_num: number;
  page_angle?: number;
  meta: { page_width: number; page_height: number };
  layouts: Layout[];
  tables?: { layout_id: string; markdown?: string }[];
  images?: { layout_id: string; image_description?: string }[];
}
export interface Region {
  id: string;
  kind: Kind;
  pageIndex: number;
  box: Rect;
  content: string;
  caption: string;
}
export interface Result extends Region {
  pdfRect: Rect;
  image: string;
}
export interface PageCache {
  schema: 1;
  sourceStamp: string;
  chartAnalysis: boolean;
  parsed: ParsedPage;
}

export function enabledKinds(switches: Switches): Kind[] {
  return (Object.keys(labels) as Kind[]).filter(kind => switches[kind]);
}

/** API position is [x,y,width,height] in a top-left page coordinate system. */
export function normalizePage(page: ParsedPage, pageIndex: number, switches: Switches): Region[] {
  const width = page.meta?.page_width;
  const height = page.meta?.page_height;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) || !Array.isArray(page.layouts)) {
    throw new Error('百度返回的页面缺少有效的尺寸或版面信息');
  }
  if (page.page_angle && page.page_angle % 360 !== 0) {
    throw new Error('百度返回了旋转页面，无法可靠匹配原文坐标；请关闭角度矫正');
  }
  const regions: Region[] = [];
  for (const layout of page.layouts) {
    const kind: Kind | undefined = ['image', 'chart'].includes(layout.type) ? 'figure'
      : layout.type === 'table' ? 'table'
      : ['display_formula', 'inline_formula', 'formula'].includes(layout.type) ? 'formula' : undefined;
    if (!kind || !switches[kind]) continue;
    if (!Array.isArray(layout.position) || layout.position.length !== 4 || !layout.position.every(Number.isFinite)) continue;
    const [x, y, w, h] = layout.position;
    if (w <= 0 || h <= 0) continue;
    const box: Rect = [Math.max(0, x), Math.max(0, y), Math.min(width, x + w), Math.min(height, y + h)];
    if (box[2] <= box[0] || box[3] <= box[1]) continue;
    const content = kind === 'table' ? page.tables?.find(t => t.layout_id === layout.layout_id)?.markdown ?? layout.text ?? ''
      : kind === 'figure' ? page.images?.find(i => i.layout_id === layout.layout_id)?.image_description ?? layout.text ?? ''
      : layout.text ?? '';
    const nearby = page.layouts.filter(candidate => candidate.type === 'figure_title' && candidate.position?.length === 4)
      .map(candidate => ({ candidate, distance: Math.abs(candidate.position[1] - box[3]) }))
      .filter(({ candidate, distance }) => distance < height * 0.06 && candidate.position[0] < box[2]
        && candidate.position[0] + candidate.position[2] > box[0])
      .sort((a, b) => a.distance - b.distance)[0];
    regions.push({ id: `${pageIndex}:${layout.layout_id}`, kind, pageIndex, box, content,
      caption: kind === 'formula' ? '' : nearby?.candidate.text ?? '' });
  }
  return regions;
}

export function parsePageRange(input: string, count: number): number[] {
  const pages = new Set<number>();
  if (!input.trim()) throw new Error('请输入页码，例如 1-5,8');
  for (const token of input.split(/[,，]/)) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`页码格式无效：${token}`);
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`页码须在 1-${count} 内，且起始页不能大于结束页`);
    for (let n = start; n <= end; n++) pages.add(n - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

export function mergeResults(existing: Result[], replacement: Result[], pageIndex: number, switches: Switches): Result[] {
  return [...existing.filter(r => r.pageIndex !== pageIndex || !switches[r.kind]), ...replacement]
    .sort((a, b) => a.pageIndex - b.pageIndex || a.box[1] - b.box[1]);
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('操作已取消');
}
