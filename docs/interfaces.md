# OCR 接口配置

插件默认选择 AI Studio；手动切换后会记住所选接口。图、表、公式开关由两套接口共用，默认识别全部页，可在 PDF 左侧栏改为当前页或指定页码（例如 `1-5,8`）。

| 接口 | 凭据 | 获取入口 |
| --- | --- | --- |
| AI Studio PaddleOCR-VL-1.6（默认） | API Key / Access Token 一项 | [AI Studio 令牌管理](https://aistudio.baidu.com/account/accessToken)、[PaddleOCR 专区](https://aistudio.baidu.com/paddleocr) |
| 百度智能云文档解析（PaddleOCR-VL） | 应用的 API Key 和 Secret Key | [文字识别控制台](https://console.bce.baidu.com/ai-engine/ocr/overview/index) |

Zotero 设置的 Figure Extract 页面和 PDF 提取侧栏都提供「获取 API Key」链接，点击后在系统浏览器打开对应平台。AI Studio 模式隐藏 Secret Key；切换至百度智能云后显示两项凭据。两套凭据独立保存在 Zotero 登录管理器中，清空一套不会删除另一套。

AI Studio 通过单 Key 的 Bearer 鉴权提交页面 PNG，固定请求 `PaddleOCR-VL-1.6` 模型；百度智能云沿用应用鉴权的异步文档解析接口，模型版本由该服务管理。普通 OCR 应用权限不能替代文档解析权限。保存不联网；「保存并验证」仅发出鉴权检查，不上传 PDF、不创建识别任务。实际服务权限、额度和模型可用性在识别时检查。

识别控件和结果均显示在 PDF 左侧栏的「图表公式」页签中。切回原生标注、缩略图或目录页签可继续阅读；关闭阅读器会取消本次识别，并保留已经完成的页面结果。开始识别时会上传所选页面，使用账户 API 额度；默认选择全部页不会自动发起识别，仍须点击「开始识别」。

每个任务固定使用启动时的接口和凭据。两套接口的页面缓存分别保存，旧版百度缓存仍可复用。导出的 JSON 在结果中记录接口和模型，不保存 API Key。表格内容按服务返回的文本保留：百度智能云可返回 Markdown，AI Studio 可返回 HTML；界面将内容作为文本展示和复制，不执行 HTML。

协议依据：[AI Studio 异步调用文档](https://ai.baidu.com/ai-doc/AISTUDIO/fml7mozw5)、[百度智能云获取应用凭据](https://ai.baidu.com/ai-doc/OCR/dk3iqnq51)。
