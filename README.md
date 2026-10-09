# Zotero Figure Extract

<img src="assets/icon.png" width="96" alt="Zotero Figure Extract 图标">

使用百度智能云「文档解析（PaddleOCR-VL）」API 提取 Zotero PDF 中的图、表和公式。该服务在 2026-10-09 的官方文档中基于 PaddleOCR-VL 1.6；插件调用托管服务，不在本地部署模型，也不通过不存在的版本参数锁定服务端模型。

项目借鉴 [zotero-figure](https://github.com/MuiseDestiny/zotero-figure) 的阅读器集成、结果卡片和裁图思路，在独立目录中实现，不改动 `参考/zotero-figure`。采用 AGPL-3.0-or-later，见 LICENSE 和 NOTICE。

最新安装包：[GitHub Releases](https://github.com/Achuan-2/zotero-figure-extract/releases/latest)。

## 功能

- **图、表、公式三个独立开关**，默认全部开启，保存选项。全部关闭时不能开始任务。
- 当前页、指定页码（如 `1-5,8`）或全文识别；页面顺序处理，显示进度并支持取消。
- 提取图片和统计图区域、表格 Markdown、行间及行内公式文本 / LaTeX；同时生成本地 PNG 裁图。
- 卡片预览、按类型筛选、复制识别文本、保存 PNG、定位 PDF 原文、手动添加 Zotero 图像标注。
- 导出 Markdown / JSON，内嵌图片，JSON 保留页码和原文坐标。导出当前筛选下的结果。
- 缓存百度解析结果；切换识别类型可以复用缓存。PDF 路径、大小或修改时间变化后，旧缓存失效。
- 单页处理成功才更新结果；取消或后续页面失败会保留已完成页面。重新处理只替换该页启用类型的结果，不删除其他类型。
- 凭据保存在 Zotero / Firefox 登录管理器，Secret Key 不写入插件偏好、缓存或导出文件。网络请求不经过会打印请求 URL 的 Zotero HTTP 调试封装。

## 安装与使用

1. 在 Zotero 中选择「工具 → 插件」，使用齿轮菜单中的「从文件安装插件」，选择 `dist/zotero-figure-extract.xpi`。
2. 在 Zotero 设置侧栏中选择「Figure Extract」，填写百度 API Key 和 Secret Key，并设置图、表、公式开关；也可使用「工具 → Figure Extract 设置…」入口。需要开通 **文档解析（PaddleOCR-VL）**；普通文字识别接口的权限不能替代该服务权限。
3. 「保存并验证」只验证 OAuth 凭据，不上传 PDF；服务权限及剩余额度由实际解析请求检查。
4. 打开 PDF，通过阅读器工具栏的「图表公式」进入提取窗口；也可以选择文献或 PDF 附件，通过文库右键菜单或工具菜单打开。文献有多个 PDF 时默认打开第一个 PDF，请直接打开目标 PDF 以明确选择。
5. 选择类型和页码，点击「开始识别」。默认只识别当前页；指定页码从 **1** 开始。

安装前已打开的阅读器可能需要关闭并重新打开 PDF，才能显示新增的工具栏按钮；工具菜单入口可直接使用。

## 独立开关的实际含义

百度官方 API 默认解析整页的图片、表格和公式，没有三个类型都能独立关闭的服务端参数。因此，插件的开关控制**是否提取、裁图和保存相应类型的结果**。关闭某类不会删除之前保存的该类结果，也不代表百度服务不处理它或按类型减免费用。

「图」开启时传入 `analysis_chart=true`，请求统计图表内容解析；关闭时设为 `false`。表格和公式通过 API 返回的 `layouts.type` 筛选。图片描述是百度返回的原始内容，公式内容按返回值保留。图注按页面内邻近的 `figure_title` 元素关联，复杂双栏排版可能需要人工核对。

首次仅识别表 / 公式时，缓存不含统计图内容解析；之后开启「图」会重新调用一次 API。已包含统计图解析的缓存可以用于任意类型组合。勾选「重新调用 API，忽略缓存」会重新上传页面。

## API 与数据路径

按照 [百度官方文档](https://ai.baidu.com/ai-doc/OCR/Qmncwhwdt) 实现：

- OAuth：`POST https://aip.baidubce.com/oauth/2.0/token`，API Key / Secret Key 放在请求体中。
- 提交：`POST https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task`，传入单页 PNG 的 `file_data` 和 `file_name`。
- 查询：`POST .../task/query`，每 5 秒轮询一次，最长等待 10 分钟。
- 成功后下载 `parse_result_url` 的 JSON，用 `pages[].layouts`、`tables`、`images`、`meta` 转换结果。

PDF 页面通过 Zotero 阅读器自带的 PDF.js 渲染，最长边不超过 2400 像素、画布不超过约 400 万像素。为保证原文坐标对应，关闭 API 的旋转矫正、扭曲矫正、水印和印章擦除。检测到不一致的尺寸比例或服务端页面旋转时会停止，避免生成错误裁图。

本地数据位于 **Zotero 数据目录 / zotero-figure-extract / 文库 ID / PDF 附件 key /**：

- `page-<从0开始的页码>.json`：单页结构化解析缓存。
- `results.json`：提取结果与内嵌 PNG，通过临时文件原子替换。

提取缓存不通过 Zotero 自动同步。手动添加到 PDF 的标注作为 Zotero 标注保存，遵循 Zotero 自身的同步行为。删除卡片只删除本地提取结果，不删除已添加的标注。点击开始后所选页面会上传百度，使用账户 API 额度；取消只停止本地等待和后续提交，已提交的云端任务可能继续执行并计费。

## 开发

需要 Node.js 20+ 和 pnpm。源码分为：`domain.ts`（类型与版面转换）、`baidu.ts`（异步 API）、`extraction.ts`（任务和缓存）、`platform.ts`（Zotero / Gecko / PDF.js 适配）、`plugin.ts`（生命周期和入口）、`ui.ts`（窗口交互）。

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

产物为 `dist/zotero-figure-extract.xpi`。构建仅打包独立插件，不读取参考插件模型，不启动 Zotero，也不调用百度 API。插件清单声明 Zotero 7–10；实际阅读器适配使用私有 API，需要在目标 Zotero 版本中确认兼容性。

Zotero 安装器要求 `applications.zotero.update_url` 必须存在，而且必须使用 HTTPS，否则会将插件判定为不可安装。更新地址为 `https://github.com/Achuan-2/zotero-figure-extract/releases/latest/download/update.json`。构建会生成安装包及 `dist/update.json`，更新清单使用对应版本 Release 的固定 XPI 地址，并包含 SHA-256 校验值。发布时必须将 XPI 和 update.json 一并上传到该版本 Release，才能让 Zotero 自动检查更新。构建会验证必填字段和 HTTPS 协议，同时输出含版本号的安装包，便于区分修复后的文件。

测试覆盖 API 提交与轮询、token 刷新、错误与取消、八种开关组合、坐标转换、缓存复用、PDF 更新失效、结果合并及失败恢复。自动测试和打包成功不等于实际 Zotero 安装、界面及百度服务验收通过。
