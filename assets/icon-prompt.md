# 图标设计记录

由内置 imagegen 生成透明 PNG，以蓝色文档、图片、表格和求和符号表达插件功能。原图保存在 `assets/icon.png`；48、96、128 像素版本只做等比缩小，保留透明通道。

重新导出尺寸：`uv run --with pillow python scripts/resize-icon.py`。

## 生成提示词

Use case: logo-brand. Asset type: production app/plugin icon for Zotero Figure Extract, a scientific PDF figure/table/formula extraction plugin. Create ONE clean square 1024x1024 icon, not a presentation sheet or mockup. A bold rich cobalt-blue rounded square tile centered with transparent outer corner area, containing a large white scholarly document with a subtle folded top-right corner. Inside the document, communicate the three extraction types using exactly three large, simple cobalt/teal pictograms: a small image/plot pictogram at the top, a 2x2 table-grid pictogram at the lower left, and a single bold mathematical summation sigma glyph at the lower right. Use broad crisp geometric forms, very thick strokes, generous spacing and optical balance; must remain readable when reduced to 48px. Modern polished flat vector-like aesthetic, no 3D, no shadows, no fine detail. Palette matches plugin UI: cobalt #315FC4 and white, with a restrained teal #22B8B0 accent. No letters, no words, no brand name, no watermark, no background scene. Only the sigma mathematical symbol is permitted. Frame the icon tightly with a small consistent transparent margin. Final output must preserve true transparency outside the blue rounded tile.
