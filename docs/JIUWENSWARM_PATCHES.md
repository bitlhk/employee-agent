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

## Patch 4b — progressive_tool_rail.py：隐藏外部 Skill Hub 工具

文件：

- 上海运行时：`/root/jiuwenclaw/lib/python3.12/site-packages/openjiuwen/harness/rails/progressive_tool_rail.py`
- 上海备份：`/root/jiuwenclaw/lib/python3.12/site-packages/openjiuwen/harness/rails/progressive_tool_rail.py.bak_linggan_hidden_tools_20260622`
- 运行时开关：`JIUWENSWARM_PROGRESSIVE_TOOL_HIDDEN_NAMES`

背景：企业 EA 的 Skill 来源应以用户工作目录和平台预装 Skill 为准，不需要模型访问
jiuwenswarm 外部 Skill Hub。实际使用中，模型可能优先调用 `search_skill`，拿到
ClawHub / SkillNet / TeamSkillsHub 的外部结果，反而绕过本地 `list_skill`，导致
“EA 显示有技能，但模型没有按本地技能工作”的误判。

当前策略：

- 上海 `.env` 设置：
  `JIUWENSWARM_PROGRESSIVE_TOOL_HIDDEN_NAMES=search_skill,install_skill,uninstall_skill`
- `ProgressiveToolRail` 在三处过滤 hidden tools：
  - 初始 visible tools 构造时不暴露。
  - `search_tools` 候选工具列表中不返回。
  - `load_tools` 请求加载时直接跳过。
- `list_skill` 不隐藏，仍允许模型查看当前 Agent 工作目录里的本地 Skill。

作用：

- 避免企业 EA Agent 被外部 Skill Hub 搜索结果干扰。
- 保留本地 Skill 可见性，便于模型理解和使用平台预装 / 用户已安装 Skill。
- 该补丁只影响 jiuwenswarm progressive tool 层的可见性，不删除任何 Skill 文件，
  也不改变 EA 技能市场展示策略。

回滚：

1. 快速回滚：删除或置空 `.env` 里的
   `JIUWENSWARM_PROGRESSIVE_TOOL_HIDDEN_NAMES`，然后重启 jiuwenswarm。
2. 完整回滚：用备份覆盖运行时文件：
   `cp progressive_tool_rail.py.bak_linggan_hidden_tools_20260622 progressive_tool_rail.py`，
   再重启 jiuwenswarm。

升级处理：

- 若上游提供官方 hidden tool / enterprise mode 配置，优先迁到官方配置。
- 若 `ProgressiveToolRail` 重构，至少要确认 `search_skill` / `install_skill` /
  `uninstall_skill` 不会进入初始 tools、`search_tools` 结果和 `load_tools` 结果。

---

## EA Patch — Jiuwen Agent 工作目录初始化与技能同步

文件：

- `server/_core/jiuwenswarm-role-scope.ts`
- `server/_core/skills/skill-registry.ts`
- `server/routers/role-runtime-adapters.ts`

背景：EA 创建 / 刷新 `lgj-*` JiuwenSwarm Agent 时，前端显示的岗位 Skill/MCP
和 JiuwenSwarm 实际工作目录可能不同步。典型问题是：

- 新建 Agent 工作目录缺少 `IDENTITY.md` / `USER.md`，模型不知道当前岗位身份和本地 Skill 使用方式。
- 技能 registry 变更后仍走 OpenClaw 的 `openclaw.json` allowlist 同步逻辑，导致日志出现
  `AGENT-SKILLS-SYNC agent entry not found`，而 JiuwenSwarm 工作目录未被刷新。

当前策略：

- `writeJiuwenSwarmRoleScopeManifest()` 在写岗位 scope 时，会按岗位生成
  `IDENTITY.md` 和 `USER.md`，但只在文件缺失时创建，不覆盖用户后续自定义内容。
- 生成的 `IDENTITY.md` 包含岗位职责、合规边界、默认 Skill/MCP 资产和“优先使用当前工作目录已安装技能”的约束。
- `lgj-*` 的 skill registry invalidation 改为刷新 JiuwenSwarm workspace：
  - 重新写 `.ea-role-scope.json`
  - 同步 `skills/` 下的平台 approved skill 链接
  - 创建缺失的 `IDENTITY.md` / `USER.md`
- `lgc-*` OpenClaw Agent 仍走原来的 OpenClaw allowlist 同步逻辑。

作用：

- 新申请 JiuwenSwarm Agent 后，EA 前端显示、岗位默认技能、实际工作目录可见技能保持一致。
- 存量用户如果已经手动调整过 `IDENTITY.md` / `USER.md`，不会被平台刷新覆盖。
- 修复技能安装 / 启停时只刷新 EA registry、没有刷新 JiuwenSwarm workspace 的问题。

回滚：

- 回滚上述三个 EA 文件到上一版本，然后重启 EA 服务。
- 已生成的 `IDENTITY.md` / `USER.md` 是普通用户工作目录文件，回滚代码不会自动删除；
  如需清理，应按具体 Agent 目录人工确认后处理。

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

## EA Bridge Guard — 原生人工确认事件短期兜底

文件：`server/_core/jiuwenclaw-bridge.ts`

背景：jiuwenswarm 的 `PermissionInterruptRail` / `ask_user` 会通过
`chat.ask_user_question` 发起原生人工确认，`source` 常见为
`permission_interrupt`、`confirm_interrupt`、`ask_user_interrupt`。EA 当前还没有实现
“前端弹窗确认 -> 后端回传同一 jiuwenswarm 会话”的完整双向链路。

当前短期策略：

- EA bridge 识别 `chat.ask_user_question` 和常见 interrupt source。
- 命中后不自动允许，也不尝试伪造确认结果。
- 直接向前端返回明确错误：
  `JiuwenSwarm 运行时请求人工确认，EA 当前未接入原生确认回传...`
- 同时写入 `jiuwenclaw-exec.log` 的
  `chat_stream_human_approval_required`，便于定位是哪类权限/确认触发。

作用：

- 避免用户只看到“输出截断 / 会话状态异常 / 一直等待”。
- 把不该触发 ask 的场景暴露出来，优先通过 workspace root、岗位授权、MCP
  服务端鉴权修正。

后续若要做完整适配：

1. bridge 需要保存 pending approval 状态和 request_id。
2. 前端渲染“本次允许 / 拒绝 / 取消任务”。
3. 用户选择后，后端必须把结果发回同一 jiuwenswarm session。
4. 审批结果必须入审计日志；`always allow` 类策略应限制为管理员能力。

---

## Patch 6（计划）— 每个 Agent 的 workdir / workspace 硬隔离

状态：**未上线，仅方案记录**。

背景：当前 jiuwenswarm 在上海按 `lgj-*` 为每个子 Agent 创建独立工作目录，例如：

```text
/root/.jiuwenswarm/service_linggan_shanghai/agent_jiuwen_<lgj-id>/agent/jiuwenclaw_workspace
```

EA 已经在运行时配置层做了短期隔离：

- `/root/.jiuwenswarm/config/config.yaml` 的 `permissions.external_directory["*"]`
  设为 `deny`。
- 每个已存在 / 新建 `agent_jiuwen_lgj-*` workspace 单独写入 `allow`。
- EA 新建 / reconcile JiuwenSwarm Agent 时，通过
  `server/_core/jiuwenswarm-permissions.ts` 自动补齐该 workspace allow 规则。

这个配置级方案能降低误读外部目录的概率，但它不是严格的 per-agent 硬隔离：

- `external_directory` 是全局配置，不绑定当前请求的 `lgj-*` 身份。
- 如果所有 Agent workspace 都被全局 allow，理论上 Agent A 仍可能访问 Agent B 的
  workspace，除非下层工具 / 权限判断再次按当前 workspace 做限制。
- 因此配置级 deny 只能作为短期兜底，不能作为最终的多租户隔离边界。

### 目标

在 jiuwenswarm 代码层按“当前会话 / 当前 Agent 的 workspace root”做强制约束：

1. 当前请求只能读写自己的 `jiuwenclaw_workspace`。
2. 对其他 `agent_jiuwen_lgj-*` 目录默认拒绝。
3. 不影响 MCP 服务端通过可信 header 做数据授权；MCP 数据隔离仍由 MCP 服务端按
   `x-linggan-agent-id` / `x-jiuwen-channel-id` 强制。
4. 先以 dry-run 日志模式验证，再切换为 deny 模式。

### 建议实现点

优先在 jiuwenswarm 的文件 / shell 工具执行入口做集中限制，而不是在 EA 前端或
提示词层做约束。候选位置需要以当前源码为准重新确认，优先查：

- `jiuwenswarm/agents/harness/common/tools/*`
- `jiuwenswarm/agents/harness/common/rails/permission*`
- `jiuwenswarm/agents/harness/common/rails/interrupt/*`
- `jiuwenswarm/server/runtime/agent_adapter/interface_deep.py`

实现思路：

1. 从当前 session / adapter / request config 解析有效 workspace：
   - `workspace_dir`
   - `project_dir`
   - 当前 cwd
   - 路径里匹配到的 `agent_jiuwen_lgj-*`
2. 将 workspace root 规范化为真实路径：

```python
allowed_root = Path(workspace_dir).resolve()
target = Path(user_supplied_path).resolve()
if target != allowed_root and allowed_root not in target.parents:
    deny(...)
```

3. 文件类工具统一走该校验：
   - read/list/glob/grep/search
   - write/edit/create/delete
   - 文件上传 / 附件落盘
4. shell / terminal 类工具至少做两层限制：
   - 默认 cwd 固定在当前 workspace。
   - 命令中出现其他
     `/root/.jiuwenswarm/service_linggan_shanghai/agent_jiuwen_*` 路径时，如果不是当前
     Agent 自己的 workspace，直接 deny。
5. 对符号链接必须按 `realpath` 后的真实路径判断，不能只看字符串前缀。
6. 拒绝事件写入日志，至少包含：
   - current agent/channel
   - allowed_root
   - denied target
   - tool name
   - session/request id

### 开关设计

建议通过环境变量或 config 增加三态开关：

```text
JIUWENSWARM_WORKSPACE_ISOLATION=off | log | deny
```

- `off`：完全关闭，等同当前行为。
- `log`：只记录越界访问，不阻断。用于上海真实流量观察。
- `deny`：阻断越界访问，返回明确错误给模型 / 前端。

上海上线顺序：

1. 本机实现 `log` 模式并跑单元 / smoke。
2. 上海先开 `log`，观察是否误伤正常 skill / MCP / 文件操作。
3. 清理误报后，对少量 `lgj-*` 开 `deny`。
4. 稳定后全量 `deny`。

### 与 MCP 的关系

这个补丁只管 JiuwenSwarm 本地工作目录和本地工具访问，不应该拦截正常 MCP 调用。

- MCP 通过 streamable-http / SSE / stdio 暴露工具时，模型看到的是 MCP tool schema。
- MCP 服务端如果访问业务数据，必须继续按可信 header 做服务端鉴权。
- 本地 workspace 隔离不能替代 MCP 数据隔离；两者边界不同。
- 如果某个 MCP 本身需要读 Agent workspace 文件，应优先通过明确的文件参数和服务端
  权限校验实现，不能依赖模型自由传任意绝对路径。

### 风险

- 可能误伤需要读取项目外配置 / 临时文件的内置工具。
- 可能影响某些 skill 通过绝对路径访问资源。
- shell 命令的静态拦截不可能完整理解所有路径访问，因此短期只能覆盖明显跨 Agent
  路径；更严格的方案需要 OS 级沙箱 / 容器 / 独立用户。
- 若上游 `0.2.3` 已经引入官方 workspace sandbox，应优先采用官方机制，本文补丁只保留
  Linggan 多租户策略差异。

### 验证用例

- Agent A 读取自己的 `IDENTITY.md`：允许。
- Agent A 读取 Agent B 的 `IDENTITY.md`：deny。
- Agent A 通过 symlink 指向 Agent B workspace：deny。
- Agent A 普通问候：不触发 deny。
- Agent A 调用本岗位 MCP：不受本地 workspace deny 影响。
- Agent A 调用本地已安装 skill：能正常读取当前 workspace 下的 skill 文件。

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
