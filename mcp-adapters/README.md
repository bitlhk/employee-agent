# Linggan MCP Adapters

本目录收纳灵感平台侧维护的 MCP adapter / bridge 源码。运行时仍可部署在
`/root/.openclaw/mcp/...` 或 `/home/ubuntu/.openclaw/mcp/...`，但源码以这里为准。

原则：

- 真实 token、cookie、内部密钥不入库。
- 每个 adapter 尽量暴露标准 MCP `initialize`、`tools/list`、`tools/call`。
- 面向 JiuwenSwarm 的 adapter 应优先读取可信 header：`x-jiuwen-channel-id`、`x-linggan-agent-id` 或 `x-openclaw-agent-id`。
- 文件类能力优先传 workspace 相对路径，由 adapter 在服务端校验路径边界后读取，不让模型直接拿到任意文件访问权。

## Inventory

| Adapter | Source | Default endpoint | Purpose |
| --- | --- | --- | --- |
| 财富助手 HTTP MCP | `wealth-assistant-http/wealth-assistant-http-mcp.mjs` | `127.0.0.1:17894/mcp` | 客户、产品等财富经理助手工具，按 `x-jiuwen-channel-id` 做用户映射。 |
| 债券报价解析 HTTP MCP | `bond-quote-http/bond-quote-http-mcp.mjs` | `127.0.0.1:17892/mcp` | BCCP 债券报价解析/校验/导出能力。 |
| 团险审核 HTTP MCP | `group-insurance-http/group-insurance-http-mcp.mjs` | `127.0.0.1:17895/mcp` | 把团险审核工作流包装成标准 HTTP MCP。 |
| 保险知识库 HTTP MCP | `insurance-kb-http/insurance-kb-http-mcp.mjs` | adapter env 决定 | FastGPT 保险知识库包装。 |
| 凭证技能代理 | `credential-skills-proxy/credential-skills-adapter.mjs` | `127.0.0.1:17896/mcp` | 转发凭证技能上游 MCP，注入 token 并清洗 JSON-RPC `error:null`。 |
| 凭证图片 workspace adapter | `credential-image-workspace/credential-image-workspace-adapter.mjs` | `127.0.0.1:17898/mcp` | 读取当前 Agent workspace 内图片/PDF，内部 base64 后调用凭证上游服务。 |
| 贷后风险数据 HTTP MCP | `post-loan-risk-data-http/post-loan-risk-data-http-mcp.mjs` | `127.0.0.1:17897/mcp` | Demo 贷后风险数据工具。 |
| 且慢 stdio bridge | `qieman-stdio-bridge/qieman-stdio-bridge.mjs` | stdio | 且慢远端 MCP stdio 桥接和工具白名单。 |
| Wind stdio bridge | `wind-stdio-bridge/wind-stdio-bridge.mjs` | stdio | Wind 远端 MCP stdio 桥接。 |

## Runtime Env Keys

以下只列 key，真实 value 放在运行机器的私有 env 文件或进程管理器中。

### `wealth-assistant-http`

- `WEALTH_MCP_HOST`
- `WEALTH_MCP_PORT`
- `WEALTH_ASSISTANT_API_BASE`
- `WEALTH_ASSISTANT_INTERNAL_TOKEN`

### `bond-quote-http`

- `BOND_QUOTE_HTTP_MCP_HOST`
- `BOND_QUOTE_HTTP_MCP_PORT`
- `BOND_QUOTE_HTTP_MCP_ENV`
- `BOND_PARSE_UPSTREAM`
- `BOND_PARSE_API_KEY`

### `group-insurance-http`

- `HOST`
- `PORT`
- `GROUP_INSURANCE_WORKFLOW_URL`
- `GROUP_INSURANCE_INTERNAL_TOKEN`
- `GROUP_INSURANCE_TIMEOUT_MS`

### `insurance-kb-http`

- `MCP_PORT`
- `FASTGPT_BASE_URL`
- `FASTGPT_API_KEY`
- `DEFAULT_KB_IDS`

### `credential-skills-proxy`

- `CRED_ADAPTER_HOST`
- `CRED_ADAPTER_PORT`
- `CRED_UPSTREAM_URL`
- `CRED_UPSTREAM_TOKEN`

### `credential-image-workspace`

见 `credential-image-workspace/.env.example`。

### `post-loan-risk-data-http`

- `MCP_PORT`

### `qieman-stdio-bridge`

- `QIEMAN_MCP_URL`
- `QIEMAN_API_KEY`

### `wind-stdio-bridge`

- `WIND_MCP_SKILL_DIR`
- `WIND_API_KEY`

## Deployment Note

当前目录只是源码归档和后续维护入口。同步到生产时建议：

1. 从本目录复制目标 adapter 源码到运行目录。
2. 在运行目录创建私有 env 文件。
3. 用 pm2/systemd 启动。
4. 在 EA 岗位授权和 JiuwenSwarm MCP config 中注册本机 `127.0.0.1` endpoint。
