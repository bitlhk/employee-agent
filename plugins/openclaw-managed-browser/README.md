# Managed Browser OpenClaw Plugin

Employee Agent 托管的受控浏览器工具插件。

## Tools

- `managed_browser_open`: 打开 URL 并返回标题、最终 URL、正文预览和少量链接。
- `managed_browser_extract`: 提取网页正文为 Markdown。
- `managed_browser_snapshot`: 返回标题、正文、标题层级和链接列表。
- `managed_browser_screenshot`: 预留截图能力；未配置浏览器运行时时会明确返回错误。

## Architecture

插件只负责向 OpenClaw 暴露工具 schema，并把调用转发给 employee-agent 内部接口：

```text
OpenClaw tool call
  -> openclaw-plugin-managed-browser
    -> POST /api/internal/managed-browser/tool
      -> employee-agent managed browser service
```

这样 URL 校验、SSRF 防护、限流、审计和后续浏览器执行器升级都留在 employee-agent 侧。

## Environment

插件固定调用 `http://127.0.0.1:5180`，不读取环境变量，也不携带密钥。
employee-agent 内部接口只接受本机回环请求，避免插件持有任何平台凭证。

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
```
