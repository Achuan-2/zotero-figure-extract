# v0.1.1 验证记录

2026-10-09，在本机 Zotero 10.0.6 的独立诊断配置中，通过真实 Gecko 插件管理器扫描 v0.1.1 安装包，记录插件 `zotero-figure-extract@achuan` 的 `active=true`、`appDisabled=false`，更新 URL 为 GitHub Release 的 HTTPS 地址。此前使用 chrome:// 更新地址的 v0.1.0 状态为 `active=false`、`appDisabled=true`。

该检查确认安装包被原生插件管理器接受。诊断配置与用户配置分开，不代表阅读器界面、真实 PDF 或百度付费服务已完成运行验收。未提供百度凭据，因此未调用真实 OCR 服务。

发布前运行 TypeScript 检查、30 项自动测试与构建验证；发布后比对 Release 下载包的 SHA-256 与更新清单。

## v0.1.2 设置页修复

2026-10-09，TypeScript 检查、37 项自动测试与构建通过。新增测试将本机 Zotero 的 `preferencePanes.js` 注册器加载到隔离 JS 沙盒，确认插件注册参数可生成侧栏页面记录并注销；另外检查设置脚本在片段 load 后读取已有凭据、持久化独立开关、关闭页面中止请求，以及凭据保存失败后恢复操作。

这些是注册器和脚本层面的回归检查，未操作用户当前的 Zotero 设置窗口，也未调用真实百度 OCR。发布后下载附件核对版本、设置页文件、更新地址和 SHA-256 校验值。

## v0.2.1 接口切换与侧栏识别

2026-10-09，TypeScript 检查、57 项自动测试及 XPI 构建通过。覆盖 AI Studio Bearer / multipart 上传、异步轮询与 JSONL 转换、错误和取消、两套接口的独立凭据与缓存、任务接口固定、获取 Key 链接，以及侧栏默认全部页、当前页 / 指定页码、独立类型开关和关闭清理。

另外在独立的 Zotero 10.0.6 headless 配置中安装新包，导入生成的三页测试 PDF，实际打开 PDF 阅读器的提取侧栏。读取到默认 `scope=all`、`provider=aistudio`、页数 3、Secret Key 隐藏、正确的 AI Studio 获取 Key 链接和可用的开始按钮；指定页码输入可显示，切回标注页签会隐藏提取面板，工具栏不存在插件按钮。插件为 `active=true`、`appDisabled=false`。

该运行检查发现并修复了 Gecko 对跨权限 MutationObserver 参数的拒绝，以及内容阅读器不能嵌入 chrome 页面的问题。侧栏使用内嵌样式的 srcdoc 文档，界面回调由插件绑定。未操作用户正在运行的 Zotero 界面，未提供真实 OCR 凭据，因此未调用云端识别服务；其他 Zotero 版本尚未完成运行验证。
