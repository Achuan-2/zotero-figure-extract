import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, enabledKinds, mergeResults, normalizePage, parsePageRange, type ParsedPage, type Result } from '../src/domain';

export const samplePage: ParsedPage = {
  page_num: 0, page_angle: 0, meta: { page_width: 1000, page_height: 1400 },
  layouts: [
    { layout_id: 'image-1', type: 'image', position: [100, 200, 400, 200], text: '' },
    { layout_id: 'caption', type: 'figure_title', position: [100, 410, 400, 20], text: 'Figure 1. Response' },
    { layout_id: 'table-1', type: 'table', position: [100, 600, 500, 200] },
    { layout_id: 'formula-1', type: 'display_formula', position: [100, 900, 300, 50], text: '$$x^2 + y^2$$' },
    { layout_id: 'inline-1', type: 'inline_formula', position: [450, 900, 50, 30], text: 'x' },
    { layout_id: 'text', type: 'text', position: [100, 100, 300, 50], text: 'Body text' },
    { layout_id: 'chart-1', type: 'chart', position: [600, 200, 300, 200] }
  ],
  tables: [{ layout_id: 'table-1', markdown: '| A | B |\n|---|---|\n| 1 | 2 |' }],
  images: [{ layout_id: 'image-1', image_description: '{"description":"response"}' }]
};

test('百度 [x,y,w,h] 转换、图注关联、表格 Markdown 和公式原样保留', () => {
  const regions = normalizePage(samplePage, 4, defaults);
  assert.equal(regions.length, 5);
  assert.deepEqual(regions[0].box, [100, 200, 500, 400]);
  assert.equal(regions[0].caption, 'Figure 1. Response');
  assert.equal(regions[0].pageIndex, 4);
  assert.equal(regions[1].content, samplePage.tables![0].markdown);
  assert.equal(regions[2].content, '$$x^2 + y^2$$');
});

test('三个独立开关的八种组合只提取启用的类型', () => {
  for (let mask = 0; mask < 8; mask++) {
    const switches = { figure: !!(mask & 1), table: !!(mask & 2), formula: !!(mask & 4) };
    const regions = normalizePage(samplePage, 0, switches);
    for (const region of regions) assert.equal(switches[region.kind], true);
    assert.equal(regions.length, (switches.figure ? 2 : 0) + (switches.table ? 1 : 0) + (switches.formula ? 2 : 0));
    assert.equal(enabledKinds(switches).length, Object.values(switches).filter(Boolean).length);
  }
});

test('排除非法矩形，裁切超出页面的区域', () => {
  const page = structuredClone(samplePage);
  page.layouts = [
    { layout_id: 'clipped', type: 'image', position: [-10, -20, 1100, 1500] },
    { layout_id: 'negative', type: 'image', position: [0, 0, -1, 5] },
    { layout_id: 'nan', type: 'image', position: [0, NaN, 10, 10] },
    { layout_id: 'outside', type: 'image', position: [2000, 0, 50, 50] }
  ];
  const regions = normalizePage(page, 0, defaults);
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].box, [0, 0, 1000, 1400]);
});

test('尺寸缺失和服务器旋转会明确报错，避免生成错误的原文坐标', () => {
  assert.throws(() => normalizePage({ ...samplePage, meta: { page_width: 0, page_height: 100 } }, 0, defaults));
  assert.throws(() => normalizePage({ ...samplePage, page_angle: 90 }, 0, defaults), /旋转/);
});

test('页码范围支持中文逗号、去重排序和严格范围检查', () => {
  assert.deepEqual(parsePageRange('5, 1-3，2', 8), [0, 1, 2, 4]);
  for (const input of ['', '0', '9', '3-1', '1-', '2.5', '1,,2', '-1']) assert.throws(() => parsePageRange(input, 8));
});

test('重新提取一类时保留其他类型和其他页面，不产生重复结果', () => {
  const existing = normalizePage(samplePage, 0, defaults).map(region => ({ ...region, image: 'data:image/png;base64,AA==', pdfRect: region.box }));
  const otherPage: Result = { ...existing[0], id: 'other-page', pageIndex: 2 };
  const replacement = [{ ...existing[1], content: 'new table' }];
  const switches = { figure: false, table: true, formula: false };
  const merged = mergeResults([...existing, otherPage], replacement, 0, switches);
  assert.equal(merged.length, 6);
  assert.equal(merged.find(r => r.kind === 'table')!.content, 'new table');
  assert.equal(merged.find(r => r.id === 'other-page')!.pageIndex, 2);
  assert.deepEqual(mergeResults(merged, replacement, 0, switches), merged);
});
