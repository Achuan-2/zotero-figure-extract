export const studioPage = {
  width: 1000, height: 1400,
  parsing_res_list: [
    { block_id: 1, block_label: 'image', block_bbox: [100, 200, 500, 400], block_content: 'image description' },
    { block_id: 2, block_label: 'table', block_bbox: [100, 600, 600, 800], block_content: '<table><tr><td>A</td></tr></table>' },
    { block_id: 3, block_label: 'formula', block_bbox: [100, 900, 400, 950], block_content: 'E=mc^2' }
  ]
};
export const jsonl = JSON.stringify({ result: { layoutParsingResults: [{ prunedResult: studioPage }] } });
