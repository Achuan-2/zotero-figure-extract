# Zotero Figure Extract

[![版本](https://img.shields.io/github/v/release/Achuan-2/zotero-figure-extract?label=version)](https://github.com/Achuan-2/zotero-figure-extract/releases/latest)
[![许可证](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

<img src="assets/icon.png" width="96" alt="Zotero Figure Extract 图标">

**在 Zotero 中提取论文里的图、表和公式，让文献整理更轻松。**

Zotero Figure Extract 是一款面向文献阅读与科研资料整理的 Zotero 插件。借助 AI Studio 或百度智能云的 PaddleOCR-VL 文档解析服务，你可以直接在 PDF 阅读器侧栏提取图片、表格和公式，预览结果、复制内容、保存图片，并导出到自己的笔记或资料中。

[下载安装](https://github.com/Achuan-2/zotero-figure-extract/releases/latest) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/Achuan-2/zotero-figure-extract/issues)

## 功能亮点

- **图、表、公式按需提取**：三种类型可独立选择，提取图片与统计图、表格内容以及行间和行内公式，并生成对应区域的裁图。
- **灵活选择识别范围**：支持当前页、指定页码或全文识别，既适合快速摘取某一页，也方便集中整理整篇论文。
- **卡片预览与类型筛选**：在阅读器侧栏中浏览提取结果，按图、表或公式筛选，随时定位到 PDF 原文核对。
- **复制文字，保存图片**：复制识别文本、表格内容或公式 LaTeX，也可以将裁图保存为 PNG，用于笔记和汇报。
- **添加 Zotero 标注**：将需要保留的内容手动添加为 PDF 图像标注，方便在后续阅读中回顾。
- **导出整理结果**：支持导出包含图片的 Markdown 或 JSON，并按当前筛选范围导出。
- **保留识别成果**：结果保存在本地，再次打开时可继续查看；识别时显示进度，支持取消，并保留已完成页面的结果。

## 安装

1. 前往 [GitHub Releases](https://github.com/Achuan-2/zotero-figure-extract/releases/latest)，下载 `.xpi` 插件安装包。
2. 在 Zotero 中打开「工具 → 插件」，点击齿轮菜单，选择「从文件安装插件」。
3. 选择下载的 `.xpi` 文件，完成安装。

安装后，PDF 阅读器左侧栏顶部会显示「图表公式」图标页签，识别控件和结果均在侧栏内显示。

## 快速开始

### 配置识别服务

默认使用 **AI Studio PaddleOCR-VL-1.6**。在 Zotero 设置中选择「Figure Extract」，点击「获取 AI Studio API Key」，填写 API Key / Access Token 即可，无需 Secret Key。也可切换百度智能云，开通 **文档解析（PaddleOCR-VL）** 后填写应用的 API Key 和 Secret Key；两套凭据分别保存。设置页和识别侧栏都提供对应平台的获取 Key 链接，详细说明见 [接口配置](docs/interfaces.md)。

### 提取与整理

1. 打开目标 PDF，展开左侧栏，点击顶部的「图表公式」图标页签。也可以从文库右键菜单或工具菜单打开该侧栏。
2. 勾选需要提取的图、表或公式，选择识别范围。默认识别全部页；指定页码时可填写 `1-5,8`，页码从 1 开始。
3. 点击「开始识别」，等待结果显示。
4. 浏览结果卡片，按需复制文本、保存图片、定位原文或添加标注；需要统一整理时，使用「导出结果…」。

## 使用说明

识别需要联网，所选 PDF 页面会上传至所选接口平台，并使用你账户的服务额度。类型开关决定保留哪些提取结果，不影响服务对整页的解析，也不代表按类型减少费用。

提取结果保存在本地，不随 Zotero 自动同步；手动添加的 PDF 标注遵循 Zotero 自身的同步设置。删除结果卡片不会删除已添加的标注。

复杂排版下的图注、表格和公式可能需要人工核对，可通过「定位原文」快速检查。

## 反馈与许可

遇到问题或有功能建议，欢迎提交 [Issue](https://github.com/Achuan-2/zotero-figure-extract/issues)。反馈时请附上 Zotero 版本、操作步骤和相关截图，便于复现。

本项目采用 [AGPL-3.0-or-later](LICENSE) 开源许可。
