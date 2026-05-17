# OpenClaw Runtime Baseline 1.0

**版本**：OpenClaw `2026.4.26 (be8c246)` + thinking patch
**发布**：2026-04-29
**状态**：observation only —— 这是灵虾**当前依赖的 OpenClaw 表面清单**，尚未跟 OpenClaw 团队达成契约共识。`CONTRACT.md` 是基于本文进一步收紧的"我们希望 OpenClaw 承诺不变"的子集。

---

## 1. 范围

本文记录灵虾平台层 (`/root/linggan-platform`) 在生产中**已经在调用**的 OpenClaw Runtime 接口与文件结构，作为后续迁移和契约协商的基线。本文不预设这些都是公开稳定 API——稳定性等级见 `CONTRACT.md`。

## 2. 部署事实

- **OpenClaw 进程**：systemd 服务 `openclaw-gateway.service`，`ExecStart=/usr/bin/openclaw gateway --force`，在 `127.0.0.1:18789` 监听
- **CLI 入口**：实际二进制是 `/usr/lib/node_modules/openclaw/openclaw.mjs`；两个 symlink：
  - `/usr/bin/openclaw` → systemd Gateway 启动用
  - `/usr/local/bin/openclaw` → 灵虾 server `child_process.execFileSync("openclaw", ...)` 走 PATH 命中
- **代理路径**：灵虾 server 跑在 `localhost:5180`，所有 OpenClaw 调用通过 `127.0.0.1:18789`（loopback，未出主机）
- **Agent 数据根**：`/root/.openclaw/agents/<runtimeAgentId>/`（以 `trial_lgc-XXX` 为主，DB agentId 为兼容 fallback）
- **Workspace 根**：`/root/.openclaw/workspace-<runtimeAgentId>/`
- **环境变量**：`CLAW_GATEWAY_PORT=18789` `CLAW_GATEWAY_TOKEN=...` `CLAW_REMOTE_HOST=127.0.0.1` `CLAW_REMOTE_OPENCLAW_HOME=/root`

## 3. 灵虾消费的 OpenClaw 接口（4 个面）

### 3.1 HTTP `/v1/chat/completions`（OpenAI 兼容层）

**端点**：`POST http://127.0.0.1:18789/v1/chat/completions`

**用途**：
- `claw-chat.ts` 主聊天 SSE 流（HTTP 回退路径）
- `claw-business.ts` 业务 agent SSE 流

**请求头**：
- `Authorization: Bearer ${CLAW_GATEWAY_TOKEN}`
- `x-openclaw-agent-id: trial_lgc-XXX`
- `x-openclaw-session-key: agent:trial_lgc-XXX:main:eN`
- `x-openclaw-model: ...`（可选，白名单内）

**响应**：标准 OpenAI SSE：`data: {chunk}\n\n` ... `data: [DONE]\n\n`
- chunk 含 `choices[0].delta.content/reasoning_content`
- 终止符 `chunk.choices[0].finish_reason in {stop, length, tool_calls, function_call}`
- chunk 含 `id` (`chatcmpl_xxx`) ——**与 OpenClaw 内部 `runId` 不存在桥接**（已实测）

**灵虾依赖的字段**：
- `data.delta.content`、`data.delta.reasoning_content`
- `finish_reason: "stop" | "length"`（批次 1+2 完成态判定）
- `[DONE]` sentinel（批次 1 sawUpstreamDone 跟踪）

### 3.2 WebSocket Native Protocol（`ws://127.0.0.1:18789/`）

**用途**：`claw-ws-proxy.ts` 浏览器代理；这是 OpenClaw control-ui 同款协议，**control-ui 内部消费，非公开稳定 API**。

**握手**：
1. Gateway 主动发 `{ event: "connect.challenge", payload: { nonce } }`
2. 灵虾用 Ed25519 device key 签名 nonce
3. 发 `{ type: "req", id, method: "connect", params: { minProtocol:3, maxProtocol:3, role:"operator", scopes, auth:{token}, device:{id,publicKey,signature,signedAt,nonce}, caps:["tool-events"] } }`
4. Gateway 回 `{ type: "res", ok: true }` 后认证通过

**RPC 方法（灵虾发往 Gateway）**：
| Method | 调用方 | 用途 |
|---|---|---|
| `connect` | claw-ws-proxy | 握手认证 |
| `sessions.create` | claw-ws-proxy | 创建/复用 main session（key=`agent:xxx:main:eN`）|
| `sessions.send` | claw-ws-proxy | 发送用户消息 |
| `sessions.reset` | claw-chat (`/new`/`/reset`) | 重置会话上下文（保留 sessionKey） |

**RPC 经 CLI 包装的等价写法**（也使用）：
```sh
openclaw gateway call <method> --url ws://127.0.0.1:18789 --token <TOKEN> --params <JSON> --json
```
- `tenant-isolation.ts` 用此模式
- `claw-chat.ts /reset` 也用

**Gateway 推给灵虾的事件**（`type: "event"`）：

| event | stream | data.phase | 含义 |
|---|---|---|---|
| `agent` | `assistant` | — | `data.delta` = assistant 文本增量 |
| `agent` | `thinking` | — | `data.delta` = reasoning 增量（DeepSeek/GLM）|
| `agent` | `tool` | `start` | 工具调用开始（含 `toolCallId`, `name`, `args`）|
| `agent` | `tool` | `update` | 工具执行中（灵虾忽略）|
| `agent` | `tool` | `result` | 工具调用完成（含 `toolCallId`, `isError`）|
| `agent` | `command_output` | `delta` | 命令输出增量（buffered by toolCallId）|
| `agent` | `command_output` | `end` | 命令输出结束（含 `output`）|
| `agent` | `item` | `start/update/end` | UI 状态条目（仅 `update.progressText` 被消费）|
| `agent` | `lifecycle` | `start` | 灵虾忽略 |
| `agent` | `lifecycle` | `end` | **runtime 完成的唯一可靠信号**（批次 b 锚点）|
| `chat` | — | — | `payload.state === "final"` → 模型输出完成（中间信号，非 lifecycle 完成）|
| `health` / `tick` / `heartbeat` | — | — | 噪声事件，灵虾忽略 |

**Broadcast 跨用户串流问题**：Gateway 以 operator.* 角色对外是全广播订阅。灵虾必须按 `payload.sessionKey` 过滤掉别人的 event（claw-ws-proxy.ts L162-164 守卫）。

### 3.3 CLI 命令（直接 spawn）

灵虾 server 通过 `child_process.execFileSync` / `execSync` 直接调：

| 命令 | 调用文件 | 用途 |
|---|---|---|
| `openclaw --version` | `index.ts:260` | 启动时健康检查 |
| `openclaw memory status [--json]` | `claw-chat.ts:163` (`/dreaming`) | 查 dreaming 记忆状态 |
| `openclaw cron list --json` | `cron-delivery.ts:82` | 后台 cron 投递 worker（独立于 claw-cron 路由）|
| `openclaw cron runs --id <id> --limit 1` | `cron-delivery.ts:103` | 后台拉某 cron 最新运行 |

### 3.4 Gateway RPC（通过 CLI 包装：`openclaw gateway call <method>`）

`helpers.ts:174` 的 `callClawGatewayRpc(method, params)` 是中央 RPC 抽象，包装 `openclaw gateway call <method> --url ws://... --token ... --params <JSON> --json --timeout 30000`。

灵虾调用的 RPC 方法清单：

| Method | params | 调用方 | 用途 |
|---|---|---|---|
| `sessions.reset` | `{ key, reason }` | `claw-chat.ts:101` (`/new`/`/reset`) | 重置会话上下文，sessionKey 不变 |
| `cron.list` | `{ includeDisabled }` | `claw-cron.ts` | 列举 cron 任务 |
| `cron.runs` | `{ id, limit }` | `claw-cron.ts` | 查 cron 历史运行 |
| `cron.add` | `{ ... payload }` | `claw-cron.ts` | 创建 cron |
| `cron.update` | `{ id, patch }` | `claw-cron.ts` | 修改 cron |
| `cron.run` | `{ id, mode: "force" }` | `claw-cron.ts` | 立即触发 cron |
| `cron.remove` | `{ id }` | `claw-cron.ts` | 删除 cron |
| `<其他>` | — | `tenant-isolation.ts` | provision 相关，按需 |

注意 `cron.list` 在两处出现：`claw-cron.ts` 走 RPC，`cron-delivery.ts` 走直接 CLI（`openclaw cron list --json`）——后者是历史路径，等价但绕过 RPC 抽象。

### 3.5 文件系统直读（绕过 RPC）

**`/root/.openclaw/agents/<runtimeAgentId>/sessions/sessions.json`**

Schema（实测 4.26）：
```json
{
  "agent:trial_lgc-xxx:main:e2": {
    "sessionId": "uuid",
    "updatedAt": ms,
    "sessionFile": "...",
    "systemSent": bool,
    "abortedLastRun": bool,
    "chatType": "...",
    "deliveryContext": "...",
    "lastChannel": "...",
    "origin": "...",
    "skillsSnapshot": { ... },
    "status": "...",
    "startedAt": ms,
    "modelProvider": "...",
    "model": "...",
    "contextTokens": int,
    "systemPromptReport": "...",
    "inputTokens": int, "outputTokens": int,
    "cacheRead": int, "cacheWrite": int,
    "estimatedCostUsd": float,
    "totalTokens": int, "totalTokensFresh": int,
    "endedAt": ms, "runtimeMs": int
  }
}
```

**灵虾依赖的字段**：仅 `sessionId`（用于反查 trajectory 文件名）。其它字段未消费。

**`/root/.openclaw/agents/<runtimeAgentId>/sessions/<sessionId>.trajectory.jsonl`**

事件类型（共 7 种，实测 4.26）：
1. `session.started`
2. `trace.metadata`
3. `context.compiled`
4. `prompt.submitted`
5. `model.completed`
6. `trace.artifacts`
7. `session.ended`

**灵虾依赖的事件**：仅 `trace.artifacts`。Schema：
```json
{
  "type": "trace.artifacts",
  "data": {
    "capturedAt": "ISO 8601 string",
    "finalStatus": "success" | "error" | "aborted" | "timed_out" | ...,
    "assistantTexts": ["string1", "string2", ...],
    "usage": { "input": int, "output": int, "total": int },
    "promptCache": { ... },
    "compactionCount": int,
    "finalPromptText": "...",
    "itemLifecycle": [ ... ],
    "toolMetas": [ ... ],
    "didSendViaMessagingTool": bool,
    "successfulCronAdds": [ ... ],
    "messagingToolSentTexts": [ ... ],
    "messagingToolSentMediaUrls": [ ... ],
    "messagingToolSentTargets": [ ... ],
    "lastToolError": null | { ... }
  }
}
```

**灵虾依赖的字段**：`data.capturedAt`、`data.finalStatus`、`data.assistantTexts`。

特性：
- `trace.artifacts` 是**增量不是累积**——每个 turn 一条，对应该轮所有 assistant 输出
- assistantTexts 是 plain string array，含工具前/后多片段；recover 端点 v1 全部拼接
- `finalStatus !== "success"` → recover 不返回文本，标 failed
- **关键缺口**：trace.artifacts 不含 OpenClaw `runId` 跟 OpenAI `chatCompletionId` 的桥接字段。`model.completed` 行有 `runId`（UUID 格式），但跟兼容层 `chatcmpl_xxx` 无映射

**`/root/.openclaw/agents/<runtimeAgentId>/sessions/<sessionId>.jsonl`**（非 trajectory）

更细粒度的 message-level 事件（128 条/会话量级）。**灵虾尚未消费此文件**——recover v1 走 trajectory 即可。

**`/root/.openclaw/workspace-<runtimeAgentId>/`**

工作目录。灵虾在 chat 结束时（HTTP `proxyRes.on("end")` / WS `lifecycle.end`）扫描此目录新生成的文件，发 `workspace_files` 事件给前端。SKIP_DIRS = `["skills", "memory", "node_modules", ".git", ".dreams", "dist", "build", ".openclaw"]`。

## 4. Thinking Patch（4.26 专项）

OpenClaw 2026.4.26 配套补丁，强制对 GLM 系 / DeepSeek 系模型设 `thinking=disabled`，避免 reasoning 文本污染主聊天 delta。补丁修在 OpenClaw 自身代码（不是灵虾），灵虾透明依赖。

**灵虾观察方式**：collected from `data.delta.reasoning_content` (WS) / `chunk.choices[0].delta.reasoning_content` (HTTP)。如果 thinking patch 失效，灵虾会突然在主聊天中混入 reasoning 文本——可作 contract test 的反例检测。

## 5. 灵虾不依赖的 OpenClaw 表面（已知存在但不调用）

为避免未来"误以为可以依赖"：
- `openclaw run` / `openclaw exec` / `openclaw skills create` 等本地 CLI 命令——不在 server 路径调用
- OpenClaw control-ui dist 静态文件——灵虾不嵌
- OpenClaw 默认前端的会话历史接口（如有）——灵虾走 localStorage 自己管
- OpenClaw 内部的多 agent 编排 / taskflow——灵虾用自己的 intent-agent

## 6. 已知风险与不变性假设

| 假设 | 风险等级 | 监测方式 |
|---|---|---|
| `lifecycle.end` 是 runtime 完成唯一可靠信号 (WS) | 高 | 缺失或语义变 → `ws_chat_response_abnormal` 计数飙升 |
| `trace.artifacts.assistantTexts` 是 plain string array | 高 | shape 变 → recover 拼接坏，`recover_response.status=failed` 飙升 |
| `sessions.json` 的 `<sessionKey>.sessionId` 字段保留 | 高 | 改名/缺失 → recover 反查 `no_session_yet` 飙升 |
| WS 协议方法名 `sessions.create / send / reset` | 高 | 改了灵虾整个聊天功能挂 |
| **Ed25519 设备身份握手协议** | **高** | **协议变 → 全部 WS 主链路连不上，登录用户无法发消息** |
| **Broadcast 跨用户过滤靠 `payload.sessionKey`** | **高** | **字段改名 → 跨用户事件串流，多租户安全边界破**（不只兼容问题）|
| **thinking patch 持续生效** | **高** | **失效 → GLM/DeepSeek 主模型 reasoning 污染主聊天 delta，演示与生产体验受损**（监测：随机抽 chat 看 `data.delta.reasoning_content` 是否漏到 main content）|
| OpenAI 兼容层 `/v1/chat/completions` 不消失 | 中 | claw-business.ts / 第三方集成依赖；HTTP fallback 路径死 |
| `cron.list / add / update / run / remove / runs` RPC 方法签名 | 中 | cron-delivery + claw-cron 拉不到/写不进任务 |
| `chatcmpl_xxx` 与内部 `runId` 永不桥接 | 低 | 反——若桥接出现，可启用精确匹配 v2 |

## 7. 与 2026.4.24 等老版本的已知差异

无（灵虾在 OpenClaw `2026.4.24 → 2026.4.26` 升级后，7 条 chat 全部 `endReason=natural`，sessions.json/trajectory schema 兼容验证；`thinking patch` 同步上线）。

## 8. 后续步骤

1. **`CONTRACT.md`** —— 把本文中"灵虾依赖"的部分提取出来，标注稳定性等级，作为推动 OpenClaw 团队认领的版本控制契约
2. **`scripts/check-openclaw-runtime-contract.ts`** —— 自动化每次 OpenClaw 升级前后的契约测试
3. **`OpenClawRuntimeAdapter`** —— 把所有散落在 `claw-chat / claw-ws-proxy / claw-recover / claw-cron / helpers` 里的 OpenClaw 调用收进单一适配器，对内吐统一 `RuntimeEvent`
