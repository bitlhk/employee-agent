# OpenClaw Runtime Contract 1.0

**契约基线**：OpenClaw `2026.4.26 (be8c246)` + thinking patch
**生效日期**：2026-04-29
**契约范围**：本文列出灵虾平台层**必须依赖**的 9 个 OpenClaw Runtime 表面。任何打破这些条款的 OpenClaw 升级 = breaking change，需在升级前与灵虾团队同步。
**契约不在范围**：参见 `BASELINE.md` 第 5 章——灵虾不依赖的 OpenClaw 表面（control-ui、内部 taskflow 等）OpenClaw 团队可自由演进。

> **说明**：本文是灵虾团队**单方面声明**的依赖契约。OpenClaw 团队尚未正式 ack。后续推动两边对齐：版本号 + CHANGELOG BREAKING 注释 + 至少一个 minor 版本的废弃窗口。

---

## 契约 1：Gateway 连接与鉴权

**端点**：`ws://127.0.0.1:18789/`（loopback；未来如外暴露需 TLS+token，本契约不涵盖）

**握手协议**：
1. 连接成功后 Gateway 发起：`{ event: "connect.challenge", payload: { nonce: string } }`
2. 客户端用 Ed25519 device key 签名 nonce，回 `{ type: "req", id, method: "connect", params: { minProtocol: 3, maxProtocol: 3, role: "operator", scopes: [...], auth: { token }, device: { id, publicKey, signature, signedAt, nonce }, caps: ["tool-events"] } }`
3. Gateway 回 `{ type: "res", ok: true }` 表示通过

**契约要点**：
- `connect.challenge` 事件结构与字段名稳定
- Ed25519 签名算法不替换（除非配套发版替换说明）
- `protocol` 版本号 `3` 不下降，灵虾兼容范围 `[minProtocol, maxProtocol]=3..3`
- `auth.token` 仍走 `CLAW_GATEWAY_TOKEN` 环境变量配置

**升级 break 影响**：所有 WS 主聊天链路连不上，登录用户无法发消息。

## 契约 2：Session RPC

灵虾 server 通过 `callClawGatewayRpc(method, params)`（CLI 包装）或 WS 直连调用：

| Method | params | 返回 |
|---|---|---|
| `sessions.create` | `{ agentId, key }` | `{ ok: true, payload: { key } }` |
| `sessions.send` | `{ key, message }` | `{ ok: true }`（异步事件流走 broadcast）|
| `sessions.reset` | `{ key, reason }` | `{ ok: true }`（清上下文，sessionKey 不变）|

**契约要点**：
- 三个 method 名不重命名
- `key` 字段是 session 主键（语义见契约 4）
- `agentId` 是字符串，对应 `~/.openclaw/agents/<agentId>/` 目录
- `sessions.reset` 必须保留 sessionKey，只清内部 sessionId 关联（灵虾 epoch bump 兼容）

**升级 break 影响**：聊天消息发不出、`/new`/`/reset` 命令失效。

## 契约 3：WS Event 类型

Gateway 通过 `{ type: "event" }` broadcast 推送的事件，灵虾消费的 5 类必须保留：

### 3.1 `agent / assistant`
```json
{ "type": "event", "event": "agent",
  "payload": { "sessionKey": "...", "stream": "assistant",
               "data": { "delta": "文本增量" } } }
```

### 3.2 `agent / thinking`
```json
{ "type": "event", "event": "agent",
  "payload": { "sessionKey": "...", "stream": "thinking",
               "data": { "delta": "reasoning 增量" } } }
```
（DeepSeek/GLM 等 reasoning 模型；与 thinking patch 配套，参见契约 9）

### 3.3 `agent / tool`
```json
{ "type": "event", "event": "agent",
  "payload": { "sessionKey": "...", "stream": "tool",
               "data": { "phase": "start" | "result",
                         "toolCallId": "...", "name": "...",
                         "args": {}, "isError": bool } } }
```

### 3.4 `agent / lifecycle.end` ⭐
```json
{ "type": "event", "event": "agent",
  "payload": { "sessionKey": "...", "stream": "lifecycle",
               "data": { "phase": "end" } } }
```
**这是 WS 路径唯一可靠的"runtime 完成"信号**。批次 b `finalizeChatNormal` 锚点。`chat.final` 单独不算完成。

### 3.5 `chat` final
```json
{ "type": "event", "event": "chat",
  "payload": { "sessionKey": "...", "state": "final" } }
```

**契约要点**：
- 5 类事件的 `event / stream / phase / state` 字段名都不改
- `data.delta` 永远是 plain string
- `lifecycle` phase 至少有 `end`（`start` 是 nice-to-have）
- 缺一类 → 灵虾对应功能链路断

**升级 break 影响**：streaming 渲染断、recover 误触发、reasoning 不显示等。

## 契约 4：多租户过滤字段（安全边界）⭐

**所有** `type=event` 的 broadcast payload 必须含 `sessionKey: string`。灵虾按此过滤跨用户事件（claw-ws-proxy.ts L162-164）。

**契约要点**：
- 字段名 `payload.sessionKey` 不改
- 字段值与 `sessions.create` 时传入的 `key` 完全一致
- **该字段缺失或语义变化 = 多租户安全边界破，跨用户串流**——这不是兼容性问题，是安全事故

**升级 break 影响**：用户 A 看到用户 B 的 chat 流，重大事故。

## 契约 5：HTTP OpenAI 兼容层

**端点**：`POST http://127.0.0.1:18789/v1/chat/completions`

**请求头**：
- `Authorization: Bearer ${token}`
- `x-openclaw-agent-id: <agentId>`
- `x-openclaw-session-key: <sessionKey>`
- `x-openclaw-model: <modelId>`（可选）

**响应**：标准 OpenAI SSE 格式，必须包含：
- `data: { "choices": [{ "delta": { "content": "..." } }] }\n\n`（streaming）
- `data: { "choices": [{ "delta": { "reasoning_content": "..." } }] }\n\n`（reasoning models）
- `data: { "choices": [{ "finish_reason": "stop" | "length" | "tool_calls" | "function_call" }] }\n\n`（终止符）
- `data: [DONE]\n\n`（流结束 sentinel）

**契约要点**：
- `[DONE]` sentinel 不取消（HTTP 路径批次 1 `sawUpstreamDone` 锚点）
- `finish_reason` 4 个枚举值不改名；`stop` / `length` 必须在传输完整时下发
- `delta.content` 永远是 plain string

**升级 break 影响**：HTTP 路径（claw-business、第三方 OpenAI 兼容客户端）流式渲染断；批次 1 完成态判定失效。

## 契约 6：Sessions 索引文件

**路径**：`/root/.openclaw/agents/<runtimeAgentId>/sessions/sessions.json`

**Schema 不变项**：
```json
{
  "<sessionKey>": {
    "sessionId": "string-uuid",
    /* 其他字段灵虾不消费，OpenClaw 可自由演进 */
  }
}
```

**契约要点**：
- 文件路径不变（`/root/.openclaw/agents/<id>/sessions/sessions.json`）
- 顶层是 `{ <sessionKey>: { sessionId: ..., ... } }` 的对象
- `sessionId` 字段名 + 字符串类型不变
- 灵虾在每次 chat truncation recover 都会读此文件做反查

**升级 break 影响**：recover 端点 100% 返回 `pending: no_session_yet`，工行客户场景的"自动捞回"链路失效。

## 契约 7：Trajectory 文件 - `trace.artifacts` 事件

**路径**：`/root/.openclaw/agents/<runtimeAgentId>/sessions/<sessionId>.trajectory.jsonl`

**事件 Schema 不变项**：
```json
{
  "type": "trace.artifacts",
  "data": {
    "capturedAt": "ISO 8601 string or epoch ms",
    "finalStatus": "success" | "error" | "aborted" | "timed_out" | <其他>,
    "assistantTexts": ["string", "string", ...]
    /* 其他字段灵虾不消费 */
  }
}
```

**契约要点**：
- `type` 值固定 `"trace.artifacts"`
- `data.capturedAt` 字段存在且可解析为时间戳
- `data.finalStatus` 字段存在；`"success"` 是 happy path 的固定值
- `data.assistantTexts` 永远是 plain string 数组（不能变成 `{text, ts}` 对象数组等）
- `trace.artifacts` 事件**仍然是增量**（每个 turn 一条）；如改为累积，灵虾时间窗算法需调整

**升级 break 影响**：recover 端点拼接出错，返回乱码；或返回 failed 提示用户。

## 契约 8：Cron RPC

灵虾 cron 调度依赖 6 个 RPC：

| Method | params | 返回（关键字段）|
|---|---|---|
| `cron.list` | `{ includeDisabled: bool }` | `{ jobs: [{ id, ... }] }` |
| `cron.add` | `{ ... payload }` | `{ id }` |
| `cron.update` | `{ id, patch }` | `{ ok: true }` |
| `cron.run` | `{ id, mode: "force" }` | `{ ok: true }` |
| `cron.remove` | `{ id }` | `{ ok: true }` |
| `cron.runs` | `{ id, limit }` | `{ runs: [...] }` |

**契约要点**：
- 6 个 method 名不改
- `id` 字段在所有 method 间一致
- `cron.list` 返回数组结构稳定（`jobs` 字段或顶层数组）

**升级 break 影响**：cron 调度任务无法管理；`cron-delivery.ts` 后台投递 worker 失效。

## 契约 9：Thinking Patch ⭐

**约定**：OpenClaw 在调用 GLM 系（`glm5/glm-5`、`glm5/glm-5.1`）和 DeepSeek 系（`deepseek/deepseek-v4-flash` 等）模型时，必须能注入 `thinking={ type: "disabled" }` 等价的请求参数，确保 reasoning content 不污染主聊天 `data.delta.content`。

**契约要点**：
- 4.26 版本以后 thinking 默认对这两个 provider 关闭（patch 已应用）
- 若未来 OpenClaw 主线合并此 patch，配置入口（环境变量 / config）需保留
- 灵虾不传额外参数，依赖 OpenClaw 默认行为

**升级 break 影响**：用户在主聊天看到 `<thinking>` 段落污染——演示与生产体验破。监测方法：随机抽样 chat 检查 `data.delta.content` 是否含 `<thinking>` / `<think>` 等标记。

---

## 契约违反响应流程

| 阶段 | 动作 |
|---|---|
| 升级前 | 跑 `scripts/check-openclaw-runtime-contract.ts` 一次（先 smoke，再 --all），2-3 分钟完成 |
| 升级中 | 灵虾 pin 旧版本不动 |
| 升级后 | 再跑同一脚本（smoke + --all）。任意一项失败 → 不切流量 / 回滚 OpenClaw 版本 / 与 OpenClaw 团队对齐 |
| 长期 | 推动 OpenClaw 在 release notes 标注 BREAKING 章节，给至少 1 个 minor 版本废弃窗口 |

## 验证脚本用法

**Smoke（被动验证，<10s，无 LLM 成本）**：
```bash
cd /root/linggan-platform
pnpm tsx scripts/check-openclaw-runtime-contract.ts            # 默认 smoke，自动挑近期 agent
pnpm tsx scripts/check-openclaw-runtime-contract.ts --json     # CI 友好 JSON
pnpm tsx scripts/check-openclaw-runtime-contract.ts --agent <id>
```
覆盖契约：C1+C2+C8（RPC liveness 经 cron.list）/ C5（HTTP 端点存活）/ C6（sessions.json schema）/ C7（trace.artifacts schema）/ C9（thinking 泄漏扫描近 5 条）。

**Full（主动 LLM call，~10-30s，1 LLM 调用约 ¥0.01-0.05 / 次）**：
```bash
pnpm tsx scripts/check-openclaw-runtime-contract.ts --full --agent trial_lgc-<id> # WS 主链路
pnpm tsx scripts/check-openclaw-runtime-contract.ts --http --agent trial_lgc-<id> # HTTP /v1/chat/completions SSE
pnpm tsx scripts/check-openclaw-runtime-contract.ts --all --agent trial_lgc-<id>  # WS + HTTP 双主动链路
```
`--full` 测 WS 主链路。流程：
1. WS 连接 → 监听 `connect.challenge` → Ed25519 签名 → 发 connect req（验证 C1）
2. `sessions.create { agentId, key: agent:<id>:contract:<ts> }`（验证 C2，sessionKey 隔离避免污染主聊天）
3. `sessions.send { message: "Reply with exactly: pong" }`（验证 C2）
4. 全程 broadcast 都按 `payload.sessionKey === 我们的 contract key` 过滤（验证 C4 多租户安全）
5. 等 `agent/assistant.delta`、`chat.final`、`agent/lifecycle.end`（验证 C3）
6. lifecycle.end 后 polling 15s 找新 `trace.artifacts.capturedAt > startedAt`（验证 C7）

`--http` 测 HTTP 兼容层主动链路。流程：
1. POST `/v1/chat/completions`，带 `x-openclaw-agent-id` 和隔离 sessionKey `agent:<id>:contract-http:<ts>`
2. 解析 SSE，必须看到 `delta.content`、`finish_reason=stop`、`data: [DONE]`
3. 支持 `delta.content` 字符串和 content blocks 数组形态
4. HTTP 完成后 polling 15s 找新 `trace.artifacts.capturedAt > startedAt`（验证 C7）

预期：`--full` 返回 6 pass；`--http` 返回 6 pass；`--all` 返回 7 pass（smoke 5 + WS + HTTP）。

### 测试副产物：contract session 留痕

每次 `--full` 在 `~/.openclaw/agents/<id>/sessions/sessions.json` 留一条 `agent:<id>:contract:<timestamp>` entry；每次 `--http` 留一条 `agent:<id>:contract-http:<timestamp>` entry。**短期保留用于升级审计**——能追溯"某次 OpenClaw 升级后 full test 真的生成了 trajectory"。

**未来需要 reaper（todo，不阻塞当前）**：
- 保留最近 30 条 contract session
- 删除超过 30 天的 contract trajectory.jsonl
- 只删除 sessionKey 含 `:contract` 的测试会话（不动 main session）
- 量级估算：daily cron 1 次 = 1 年约 365 entries ≈ 1.8 MB，不是当前风险

## 演进路径

- **1.0**（本文）：单方面声明的依赖清单
- **1.5**：与 OpenClaw 团队对齐，OpenClaw 在 changelog 里标注 BREAKING；灵虾推动添加 `chatCompletionId ↔ runtimeRunId` 桥接字段（启用 recover v2 精确匹配）
- **2.0**：OpenClaw 暴露 stable Runtime API（`/v1/runs`、`/v1/runs/:id/events` 等），灵虾从兼容层 + WS 切到正式 API；本文移交 OpenClaw 仓库共维护
