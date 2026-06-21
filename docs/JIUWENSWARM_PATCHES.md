# JiuwenSwarm Runtime Patches

> 内部文档，**不进 OSS 构建**（含内部路径、agent-id 规律、上游源码细节）。
> 记录我们对 jiuwenswarm（jiuwenclaw）运行时打的本地补丁，便于升级时重新移植。

## 环境

- 安装方式：可编辑安装（editable）自源码目录。上海当前目录为
  `/root/jiuwenswarm-upstream-src`；本机当前目录为
  `/home/ubuntu/jiuwenclaw-upstream`。
- 上游仓：`https://gitcode.com/openJiuwen/jiuwenclaw.git`。项目后续已从
  `jiuwenclaw` 更名为 `jiuwenswarm`，文档中旧路径只表示历史文件名。
- 当前运行版本：`0.2.2`。上海服务名为 `jiuwenswarm.service`。
- 补丁形态：**源码树里的本地改动 + 运行时配置**。升级时必须逐条比对本文补丁是否仍需要 / 能否平移。
- 本地/上海版本展示：EA 通过 `/api/meta/runtime-versions` 动态读取
  `jiuwenswarm --version` / Python package metadata，不应在前端写死版本号。
- 本地检查（2026-06-17）：本机没有安装 `jiuwenswarm` Python 包，也没有
  `/root/jiuwenclaw-enterprise-src`。已单独拉取干净上游到
  `/home/ubuntu/jiuwenclaw-upstream`，当前 `develop` 为 `da6da5f5`；tag 中未见字面
  `0.22`，实际按 `JiuwenSwarm0.2.2` / `jiuwenswarm0.2.2_release` 处理。
- 本地 re-port（2026-06-18）：`/home/ubuntu/jiuwenclaw-upstream` 已更新到 develop
  `f538993e`，并把 Patch 1 / Patch 2 重新移植到 `jiuwenswarm` 包源码。源码级验证已通过：
  `py_compile`、`streamable-http` MCP config builder、`x-linggan-agent-id` /
  `x-jiuwen-channel-id` header 注入。财富助手 v2.1 HTTP MCP 已用
  `x-linggan-agent-id=jiuwen_lgj-liwenhua` 直连验证通过，local WebChannel 基础流式
  smoke 通过；本地临时 `lgj-p2e2e*` 财富经理 Agent 已完成 role-based provisioning
  + 财富助手 MCP tool-call E2E。
- 上海同步（2026-06-21）：`stream_event_rail.py` 与本机已同步。上海
  `/root/.jiuwenswarm/config/config.yaml` 已打开 progressive tool disclosure，
  新建/存量 `lgj-*` Agent 按岗位同步 Skill/MCP 后，EA 前端显示、jiuwenswarm
  注册状态和运行时工具可见性应保持一致。

补丁目的一句话：**让 jiuwenswarm 接住 streamable-http MCP，并把每个请求的真实用户身份（`lgj-*` channel_id）可信地注入 MCP 调用，实现按用户的数据隔离。** 这正是岗位权限设计里「MCP Data Authorization / 可信上下文传播」依赖的底座。

---

## Patch 1 — interface_deep.py：streamable-http MCP 支持 + 连接级用户上下文

文件：`jiuwenclaw/server/runtime/agent_adapter/interface_deep.py`
备份：`interface_deep.py.bak-mcp-fix`
类：`JiuWenClawDeepAdapter`

含三处改动：

1. **transport 规范化**：上游只认 `stdio` / `sse`，直接拒收 `streamable-http`。补丁把 `streamable-http` 归一为 `streamable_http` 并放行（`_build_mcp_server_config`）。
2. **auth_headers**：`streamable_http` 的鉴权头要走 `payload["auth_headers"]`，而不是 `params["headers"]`。补丁在 client_type 为 `streamable_http` 时同时写入 `auth_headers`。
3. **连接级用户上下文**：`_register_mcp_servers_from_config` 从 `workspace_dir` 解析出 `agent_jiuwen_lgj-*` 的 agent/channel，对带 `user_context: true` 的 MCP server，在注册时注入 `x-linggan-agent-id` 和 `x-jiuwen-channel-id` 到 `auth_headers`。

作用：没有 #1/#2，jiuwenswarm 无法连我们任何 streamable-http MCP（Wind/盈米/财富助手/insurance_kb 全连不上）。#3 是数据隔离的第一道（连接级）。

升级处理（0.2.2 及后续）：重点看上游是否已**原生支持 streamable-http**。
- 若已原生支持 → #1/#2 可弃用，只保留 #3（或看是否有等价的 user_context 机制）。
- 若重构了 `_build_mcp_server_config` / `_register_mcp_servers_from_config` → 三处都要重新移植。
- 本地上游检查（2026-06-17）：`jiuwenswarm/server/runtime/agent_adapter/interface_deep.py`
  的 `_build_mcp_server_config` 仍只允许 `stdio` / `sse`，并把 HTTP headers 写入
  `params["headers"]`。因此我们的 `streamable-http` / `auth_headers` 补丁仍需要。
- 本地 re-port（2026-06-18）：`_build_mcp_server_config` 已支持
  `streamable-http` / `streamable_http`，并将 HTTP headers 写入 `McpServerConfig.auth_headers`；
  `timeout_s` 仍保留在 `params`。源码级 smoke 确认 `client_type=streamable-http`、
  `auth_headers` 正常。带 `user_context: true` 的配置即使未显式写 `headers`，也会从
  workspace 解析并注入 `x-linggan-agent-id=jiuwen_lgj-*` 与 `x-jiuwen-channel-id=lgj-*`；
  普通 MCP 不注入上下文 header。

---

## Patch 2 — stream_event_rail.py：工具结果事件兜底 + 禁止隐藏参数注入

文件：`jiuwenclaw/agents/harness/common/rails/stream_event_rail.py`
备份：`stream_event_rail.py.bak-patch5-20260611`
类：`JiuSwarmStreamEventRail`，方法 `after_tool_call`

背景：早期方案曾尝试在 `before_tool_call` 里把内部字段
`__jiuwen_channel_id` 注入 `tool_call.arguments`，作为请求级身份参数。0.2.2 E2E
验证证明这个方案不可用：openjiuwen 在调用 MCP 前会按 MCP tool schema 校验参数，
隐藏字段不在 schema 内会触发 Pydantic `extra_forbidden`，工具根本不会到达 MCP 服务。

当前 Patch 2 的规则：

- **不要**把 `__jiuwen_channel_id` 或任何内部身份字段写入 LLM-visible tool
  arguments。
- 身份上下文通过 Patch 1 的 runtime-controlled headers 传递：
  `x-linggan-agent-id` / `x-jiuwen-channel-id`。MCP 服务端必须基于这些可信 header
  做数据隔离，不信任模型参数。
- `after_tool_call` 中保留一个结果兜底：如果 `ctx.inputs.tool_result` 为空但
  `ctx.inputs.tool_msg.content` 有内容，前端 `chat.tool_result` 使用 tool message
  content，避免工具失败时前端只看到空结果。

作用：避免内部身份参数污染 MCP schema，同时让工具错误/结果能正确透到 EA 前端。
数据隔离的硬保证在 Patch 1 header + MCP 服务端鉴权。

升级处理（0.2.2 及后续）：
- 看 `JiuSwarmStreamEventRail.after_tool_call` / `ToolCallInputs.tool_result` /
  `tool_msg` 契约是否变化。
- 看上游是否提供官方的可信上下文 header / per-request MCP auth 机制；若有，迁到官方机制。
- 明确禁止恢复旧的 `__jiuwen_channel_id` tool-argument 注入，除非目标 MCP tool
  schema 明确声明该字段并且服务端会强制覆盖模型输入。
- 本地上游检查（2026-06-17）：`jiuwenswarm/agents/harness/common/rails/stream_event_rail.py`
  的 `before_tool_call` 仍只做暂停检查、事件发送和 in-flight 跟踪，没有请求级
  channel 注入逻辑。因此财富助手这类多租户 MCP 仍需要 Patch 2 或等价官方机制。
- 本地 re-port（2026-06-18）：0.2.2 E2E 确认旧的 `__jiuwen_channel_id`
  tool-argument 注入会导致 wealth assistant MCP 调用在 schema 校验阶段失败：
  `extra_forbidden`。当前源码已移除该注入，保留 `after_tool_call` 结果兜底。
  临时 `lgj-p2e2e*` 财富经理 Agent 已通过财富助手客户清单 tool-call E2E：
  能返回张伟、李娜、王强，并完成 GLM-5.2 续写。

---

## Patch 2b — stream_event_rail.py：空字符串工具参数归一化

文件：`jiuwenswarm/agents/harness/common/rails/stream_event_rail.py`

背景：0.2.2 在部分 MCP 工具调用链上会把工具参数保存成空字符串 `""`，
后续 replay / before-tool-call 阶段没有统一归一化，容易触发空参数、空工具名
或重复 `context_probe` 式调用。典型现象是财富经理 Agent 在推荐产品时长时间
卡在工具链里，模型输入被异常放大。

当前补丁规则：

- `before_tool_call` 进入实际工具执行前，先归一化当前 tool call arguments。
- 空字符串 `""` 统一视为 `{}`，而不是继续作为原始字符串传入。
- replay 历史归一化不能因为 `raw.strip()` 为空就跳过；只要是字符串就进入
  `_ensure_json_arguments()`。

验证：

- `python3 -m py_compile jiuwenswarm/agents/harness/common/rails/stream_event_rail.py`
  通过。
- 上海财富经理查询“给刘芳推荐产品”从多轮空工具/异常大输入，收敛为正常
  财富助手客户/产品工具链调用。

升级处理：

- 若上游已修复 tool-call argument normalization，可移除本地补丁。
- 若保留本地补丁，必须覆盖普通 `{}`、空字符串 `""`、已有 JSON 字符串和非 JSON
  字符串四类输入。

---

## Patch 4 — progressive tool disclosure：渐进式工具披露

文件：

- 运行时配置：`/root/.jiuwenswarm/config/config.yaml`（上海）
- 默认资源配置：`jiuwenswarm/resources/config.yaml`（本机源码）

当前策略：

- `progressive_tool.enabled: true`
- `progressive_tool.max_loaded_tools: 8`
- `skill_mode: auto_list`

含义：

- Agent 初始上下文只暴露少量默认工具，例如 `search_tools` / `load_tools`。
- 业务 MCP 工具不在普通问候、天气等无关对话中全量塞进模型上下文。
- 模型需要业务能力时先调用 `search_tools` 找候选工具，再调用 `load_tools`
  将少量工具加入当前会话可见集合。

已验证行为：

- “北京天气”链路只触发 `search_tools`、`load_tools(fetch_webpage)` 和
  `fetch_webpage`，没有注入全部财富助手 / Wind / 保险等 MCP schema。
- 同一会话里已加载工具会继续可见，这是 jiuwenswarm progressive tool 的正常
  session 级行为。

风险与边界：

- 该机制降低 token 和工具 schema 噪声，但不是权限边界。岗位授权仍由 EA 的
  role grants、jiuwenswarm 注册配置和 MCP 服务端鉴权共同保证。
- 若模型找不到工具，需要改工具命名/描述，不应退回全量工具注入。

---

## Patch 5 — 财富助手 product MCP 运行时热修

文件：

- 上海运行时：`/root/.openclaw/mcp/wealth-assistant-v2.1/mcp-servers-deploy/product-mcp-server/dist/api-client.js`
- 快照：`docs/runtime-snapshots/shanghai-20260621/wealth-product-api-client.js`

背景：财富经理推荐产品时，产品搜索接口曾返回大量 `_desc` 字段和完整产品明细，
单次工具结果约 54KB，导致后续模型输入升到 4 万 token 以上，响应非常慢。

当前热修：

- `riskRating` 支持 `R2` / `2` 归一化。
- 搜索结果默认压缩为产品摘要；详细信息继续通过
  `wealth_assistant_product_info` 获取。
- `pageSize` 做默认值和上限控制。

验证：

- 直连 MCP `riskRating=R2&pageSize=10` 返回约 2.6KB 摘要结果。

升级处理：

- 这属于业务 MCP 的 dist 热修，不是 jiuwenswarm 上游补丁。后续应回写到财富助手
  MCP 源码或发布包，避免重启/重装后丢失。

---

## Patch 3 — IDENTITY_ZH.md：身份模板标题（外观）

文件：`jiuwenclaw/resources/agent/workspace/IDENTITY_ZH.md`
改动：标题 `# 身份` → `## 身份设定`。
作用：纯展示/排版，无功能影响。升级可忽略，冲突直接以新版为准。

---

## 升级操作顺序

1. 在干净环境（本地或 Singapore）拉目标版本源码，**先不打补丁**跑基础冒烟（启动、普通对话、流式）。
2. 逐条比对本文 Patch 1/2：
   - 用 `git diff` 对照补丁涉及的函数在目标版本是否仍存在 / 是否改名重构。
   - 测一个 streamable-http MCP（如 insurance_kb）能否原生连通——决定 Patch 1#1/#2 是否还需要。
   - 测多用户并发下 wealth_assistant 是否仍按 channel 隔离——决定 Patch 2 是否还需要。
3. 需要的补丁重新移植，更新本文的行号/函数名引用。
4. Singapore 验证通过后再上 Shanghai（生产，最后升）。

## 模型认证边界

jiuwenswarm 不复用 OpenClaw/Codex 的认证方式：

- OpenClaw/Codex 走各 agentDir 下的 `openclaw-agent.sqlite` / Codex auth store，
  常见操作是 `openclaw agents add <id>` 或复制 portable static auth profile。
- jiuwenswarm 走自身 `config.yaml` / 环境变量模型配置，默认读取
  `API_KEY`、`API_BASE`、`MODEL_NAME`、`MODEL_PROVIDER`，并支持
  `models.defaults[].model_client_config`。
- 因此 EA 在创建 `lgj-*` jiuwenswarm Agent 时，不能假设 OpenClaw 已登录的
  Codex/OpenAI 认证可用；必须由 jiuwenswarm 运行进程环境或平台受控配置提供
  `openai/gpt-5.5` 所需的模型 key/base/provider。
- provider 应统一使用 `openai`，不要使用历史上的 `openai-codex` provider 名称。
- 多 agent 场景下，模型密钥应是平台侧 runtime 级受控配置，不写入用户工作目录；
  用户只选择岗位，不能直接编辑模型认证。
