import type { ParsedPage } from '../src/domain';
export const page: ParsedPage = {
  page_num: 0, meta: { page_width: 1000, page_height: 1400 },
  layouts: [
    { layout_id: 'f', type: 'image', position: [100, 200, 400, 200] },
    { layout_id: 't', type: 'table', position: [100, 600, 500, 200] },
    { layout_id: 'e', type: 'display_formula', position: [100, 900, 300, 50], text: 'E=mc^2' }
  ], tables: [{ layout_id: 't', markdown: '| A |\n|---|\n| 1 |' }]
};
