# Credential Image Workspace Adapter

轻量 MCP adapter，用于企业 EA / JiuwenSwarm 场景下处理用户工作目录里的凭证图片。

目标不是做通用文件服务，也不引入 OSS / file_id。工具只接受当前 Agent workspace 内的相对路径，adapter 在服务端本机读取文件、校验路径边界、必要时压缩图片，再把 base64/data URI 传给上游凭证识别 MCP 服务。

## Tool

`credential_image_extract_from_workspace`

Input:

```json
{
  "workspace_relative_path": "登机牌-CZ3587.jpg",
  "document_type": "auto",
  "task": "extract_fields",
  "question": "提取航班号、姓名、出发地和目的地"
}
```

`task` 支持：

- `extract_fields`
- `classify`
- `generate_prompt`

## Workspace Resolution

优先从 JiuwenSwarm 注入的可信 header 取用户身份：

- `x-jiuwen-channel-id`
- `x-linggan-agent-id`
- `x-openclaw-agent-id`

也支持工具参数传入 `agent_id`，用于本地 smoke。生产建议依赖可信 header。

解析路径：

```text
<CREDENTIAL_JIUWEN_SERVICE_ROOTS>/agent_jiuwen_<lgj-id>/agent/jiuwenclaw_workspace
```

读取文件时会拒绝绝对路径、`..` 越界和不在白名单内的扩展名。

## Runtime

```bash
cp .env.example credential-image-workspace-adapter.env
node credential-image-workspace-adapter.mjs
```

默认监听 `127.0.0.1:17898`，MCP 入口为 `POST /mcp`，健康检查为 `GET /health`。

## JiuwenSwarm Registration

示例：

```json
{
  "credential_image_workspace": {
    "type": "streamable_http",
    "url": "http://127.0.0.1:17898/mcp",
    "user_context": true
  }
}
```

## Notes

- adapter 不落盘 base64，不在日志里打印文件内容。
- 如果本机安装了 `sharp`，图片会自动缩放压缩；未安装时会原样 base64 透传。
- 上游工具名通过 env 配置，确认服务端真实 tool schema 后只需要改 env，不改代码。
