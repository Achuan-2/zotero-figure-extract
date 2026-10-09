# v0.1.1 验证记录

2026-10-09，在本机 Zotero 10.0.6 的独立诊断配置中，通过真实 Gecko 插件管理器扫描 v0.1.1 安装包，记录插件 `zotero-figure-extract@achuan` 的 `active=true`、`appDisabled=false`，更新 URL 为 GitHub Release 的 HTTPS 地址。此前使用 chrome:// 更新地址的 v0.1.0 状态为 `active=false`、`appDisabled=true`。

该检查确认安装包被原生插件管理器接受。诊断配置与用户配置分开，不代表阅读器界面、真实 PDF 或百度付费服务已完成运行验收。未提供百度凭据，因此未调用真实 OCR 服务。

发布前运行 TypeScript 检查、30 项自动测试与构建验证；发布后比对 Release 下载包的 SHA-256 与更新清单。
