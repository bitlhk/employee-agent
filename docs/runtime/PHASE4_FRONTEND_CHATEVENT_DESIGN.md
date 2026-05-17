# Phase 4：前端 ChatEvent 统一设计草案

**状态**：设计草稿（2026-04-29，待 review 后实施）
**前置**：Adapter Phase 1-3.B 已上线（后端 RuntimeEvent normalizer 收口完成）
**目标**：前端只消费统一 `ChatEvent` 流，HTTP SSE 和 WebSocket 只是底层 transport 实现，可热切换；Home.tsx 删除两条 parallel SSE 解析（约 400 LOC → 0）。

---

## 1. 现状

`Home.tsx` 1500+ 行里，**两条平行的 SSE/WS chunk 解析路径**：

| 路径 | 位置 | 入口 | 解析职责 |
|---|---|---|---|
| HTTP SSE | L1091+（约 200 LOC）| `fetch + body.getReader()` 手动 split SSE 行 | `__stream_*` / `event:` / JSON.parse / delta extraction / finish_reason |
| WebSocket | L609+（约 200 LOC）| `wsClient.setRawHandler(chunk => ...)` | 同上 + Gateway 原生事件 routing |

**两条路径的差异**：
- HTTP 走灵虾后端 SSE → backend 已经 normalize → 前端拿到的是 `__stream_*` + OpenAI compat shape
- WS 走灵虾 ws-proxy → backend 已经 normalize → 前端拿到的也是 OpenAI compat shape + `__stream_*`

**重复的代码**：
- `__stream_end / __stream_truncated / __stream_end_length / __stream_error` 处理：两份
- `handleStreamTruncated` 调用：两份
- finish_reason=stop 双保险：两份
- `setLingxiaMsgs` 状态变更逻辑：两份

**问题**：
- 两路径有 bug 时要修两次（昨天 Phase 3.B 验证就需要两边都看）
- 想加新事件类型（如 `__stream_warning`）要 grep 后双改
- 前端 transport 切换（去 WS / 单 HTTP / 双工）需要重写 Home.tsx 主聊天逻辑
- ChatMessage 渲染热路径离 transport 解析太近，违反 demo hot path 禁碰原则

## 2. 设计原则

1. **mirror 后端 RuntimeEvent**：前端 ChatEvent **= RuntimeEvent ∪ TransportEvent**；前者是 OpenClaw 真实 emit 的事实，后者是灵虾 transport 层合成的状态（`truncated / connection_error` 等）
2. **transport 可替换**：`Transport` 接口暴露 `subscribe(handler) / send / close`；`HttpTransport` / `WsTransport` 实现该接口；上层 `useChat` 不知道在用哪个
3. **不动 ChatMessage**：渲染层完全不改（demo hot path 禁碰原则）；改的是 Home.tsx 把 chunk 解析逻辑迁出
4. **不破坏现有线上**：渐进迁移；4.A-4.F 每个阶段独立可上线、独立可回滚
5. **不改后端 SSE wire format**：前端 transport 适配器吃当前格式输出 ChatEvent；后端**不动**（这一点不要弄成大重构）

## 3. ChatEvent 类型设计

放在 `shared/runtime/chat-event.ts`（前后端共用，前端不能 import server，shared 是中转区）：

```ts
// 直接复用后端 RuntimeEvent
import type { RuntimeEvent } from "../../server/_core/runtime/types";
//   ^^ 实际：把 RuntimeEvent 类型从 server/_core/runtime/types.ts 平移到
//      shared/runtime/types.ts，server 那边变成 re-export。零行为变更。

export type ChatEvent =
  // —— Runtime 层（OpenClaw emit）—— 直接复用
  | RuntimeEvent
  // —— Transport 层（灵虾合成）——
  | { type: "transport.connected" }
  | { type: "transport.disconnected"; reason?: "client_close" | "network" | "server_close" }
  | { type: "transport.truncated"; adoptId: string; sessionKey?: string; streamEndMs: number; chatCompletionId?: string | null; startedAt: number; endReason?: string }
  | { type: "transport.length_limit" }       // backend __stream_end_length
  | { type: "transport.stream_end" }          // backend __stream_end / lifecycle.end
  | { type: "transport.error"; message: string }
  // —— 业务层（灵虾 SSE 自己的 protocol overlay）——
  | { type: "agent_dispatch"; tasks: Array<{ id; agentId; agentName; prompt }> }
  | { type: "workspace_files"; adoptId: string; files: Array<{ name; size; path }> }
  | { type: "perf"; routeEnterMs?: number; gatewayRequestStartMs?: number; upstreamFirstChunkMs?: number; streamEndMs?: number };
```

**口径声明**（写进类型 JSDoc）：
- `Runtime` 类事件 = OpenClaw 原生输出
- `transport.*` 事件 = 灵虾后端合成（基于上游 EOF / finish_reason 推断）
- 业务层事件（agent_dispatch / workspace_files / perf）= 灵虾自己的 protocol，不属于 OpenClaw 也不属于 transport

## 4. Transport 接口设计

`client/src/_core/transport.ts`：

```ts
export interface ChatTransport {
  subscribe(handler: (event: ChatEvent) => void): void;
  unsubscribe(): void;
  send(message: string, opts?: { model?: string; pendingToolContext?: any }): Promise<void>;
  close(): void;
  readonly state: "idle" | "connecting" | "ready" | "streaming" | "closed";
}
```

### 4.1 `HttpChatTransport`（`http-transport.ts`，约 150 LOC）

包装当前 Home.tsx L1091+ 的 fetch + body.getReader + SSE 解析：
- send() 起 fetch POST + 拿 reader
- 内部 SSE 行解析 → 调用 `parseSseLineToChatEvent(line)` → 触发 subscribe handler
- close() 调 `reader.cancel()`

`parseSseLineToChatEvent` 是纯函数，可独立单元测试。它解析当前后端 SSE wire format（`data: {chunk}` / `event: tool_call\ndata: ...` / `data: [DONE]`）→ ChatEvent。

### 4.2 `WsChatTransport`（`ws-transport.ts`，约 100 LOC）

包装当前 Home.tsx L609+ 的 wsClient.setRawHandler：
- 共用同一份 `parseSseLineToChatEvent` —— **关键**：当前后端 ws-proxy 已经把 broadcast event normalize 成跟 HTTP SSE 同款 OpenAI shape + `__stream_*`，所以前端解析逻辑可以**复用同一份**

复用率 ≈ 80%。剩下 20% 是 transport 状态（connect/close）的 wrap 不同。

## 5. `useChat` hook 设计

`client/src/hooks/useChat.ts`，~200 LOC：

```ts
export function useChat(adoptId: string, opts?: UseChatOptions): {
  messages: LxMsg[];
  isStreaming: boolean;
  send: (text: string) => Promise<void>;
  abort: () => void;
} {
  const [messages, setMessages] = useState<LxMsg[]>(/* localStorage init */);
  const messagesRef = useRef(messages);  // 同 lingxiaMsgsRef，保持现有 recover snapshot 行为
  
  const transport = useMemo(() => {
    return wsAvailable
      ? new WsChatTransport(adoptId)
      : new HttpChatTransport(adoptId);
  }, [adoptId, wsAvailable]);

  useEffect(() => {
    transport.subscribe((event) => {
      switch (event.type) {
        case "delta": appendDelta(event.content); break;
        case "thinking": appendThinking(event.content); break;
        case "tool_call": handleToolCall(event); break;
        case "transport.truncated": handleStreamTruncated(event, messagesRef.current, setMessages); break;
        case "transport.stream_end": setIsStreaming(false); break;
        // ... 一个 switch 就够了
      }
    });
    return () => transport.unsubscribe();
  }, [transport]);

  return { messages, isStreaming, send, abort };
}
```

Home.tsx 改动后：

```tsx
function Home() {
  const { messages, isStreaming, send, abort } = useChat(adoptId);
  return <ChatMessage messages={messages} ... />
}
```

**Home.tsx 1500+ 行 → 大约 600-700 行**（删减 800-900 行 SSE/WS parsing + state mutation 逻辑）。

## 6. 渐进上线（4.A-4.F）

| 阶段 | 内容 | 行数 | 可独立上线 |
|---|---|---|---|
| 4.A | RuntimeEvent type 从 server 平移到 shared/runtime/types.ts；ChatEvent 类型定义；Transport 接口（types only） | ~80 | ✓ 不动行为 |
| 4.B | `parseSseLineToChatEvent` 纯函数 + vitest 单测（喂真生产 sample，断言输出）| ~150 | ✓ 不动行为 |
| 4.C | `HttpChatTransport` 实现 + 单测；**线上仍用旧 Home.tsx 路径**，新 transport 仅 unit test | ~200 | ✓ 不动行为 |
| 4.D | `WsChatTransport` 实现 + 单测 | ~150 | ✓ 不动行为 |
| 4.E | `useChat` hook 实现 + 在 **新页面**（如 `/test-chat`）灰度试用 | ~250 | ✓ 旧页面不动 |
| 4.F | Home.tsx 主聊天切到 useChat；老 SSE/WS handler 删除 | -800 | ⚠️ 大改，需要灰度 flag |

**关键 invariant**：阶段 4.A-4.E 上线后，**Home.tsx 完全不变**；阶段 4.F 才动 Home.tsx，且通过 feature flag 切流（如 `USE_NEW_CHAT_TRANSPORT=allowlist:2,...`）。

## 7. 风险与开放问题

| 风险 | 处理 |
|---|---|
| `lingxiaMsgsRef` 跨 transport 工作不同步 | useChat 内部维护 ref，保持现有快照行为 |
| WsChatTransport 的连接生命周期跨多 chat | 沿用现有 wsClient（`OpenClawWSClient`）持久连接，transport 只 wrap 一次 connect 后多次 send |
| handleStreamTruncated 短轮询 5s × 60 仍在 useChat 内？ | 是。recover 是 transport 层副作用，归 useChat |
| ChatMessage 不动是否真做得到 | 是。useChat 输出的 messages 跟现在 lingxiaMsgs shape 兼容（含 id / role / text / status / toolCalls / recovering 等字段）|
| 后端 SSE wire format 改动会反推前端 transport adapter | 不会反推 ChatEvent；transport 适配器吸收 wire format 变化 |
| Phase 4.F 灰度怎么做 | 加 `process.env.USE_NEW_CHAT_TRANSPORT` 控制 flag；前端读后端注入；同 SSE_TRUNCATE_DETECT 模式 |
| Recover 端点 polling 是否可独立成 hook | 可。`useStreamRecover(messageId, adoptId, streamEndMs)`；将来跨 transport 复用 |

## 8. 跟 Phase 1-3 的关系

- **Phase 1**（read-only adapter）：后端 read 操作收口 ✓
- **Phase 2**（types + normalizer）：后端 OpenClaw → RuntimeEvent 收口 ✓
- **Phase 3.A/B**（HTTP/WS 热路径）：后端 transport 层都用 normalizer ✓
- **Phase 3.C**（清理旧 fallthrough）：等 1-2 天观察后做，与 Phase 4 正交
- **Phase 4**（前端 ChatEvent）：前端 transport → ChatEvent 收口
- **Phase 5（远期）**：移除 OpenAI compat 依赖，灵虾后端直接吐 ChatEvent JSON over wire；transport 层零解析；与 OpenClaw Native Protocol 1.5 对齐

## 9. 工时估算

| 阶段 | 工时 |
|---|---|
| 4.A type + transport 接口 | 1h |
| 4.B parseSseLineToChatEvent + 单测 | 2h |
| 4.C HttpChatTransport | 2h |
| 4.D WsChatTransport | 2h |
| 4.E useChat hook + 灰度页面 | 3h |
| 4.F Home.tsx 切换 + 灰度上线 + 观察 | 4h（含 1h 灰度观察）|
| **合计** | **14h** ≈ 2 天 |

## 10. 推荐启动条件

**不要立即开 Phase 4，等以下都满足**：
- ✅ Phase 3.B 在线上跑稳 1-2 天，`ws_chat_response_abnormal` 占比 < 1%
- ⏳ Phase 3.C（清理旧 WS handler fallthrough）落地（避免 Phase 4 时还要兼容旧 path）
- ⏳ `--http full` contract test 上线（让 HTTP 路径也有自动闸门）
- ⏳ Demo / 工行客户场景没有迫近的 deadline（Phase 4.F 是大改，要有空闲窗口）

满足后启动建议顺序：4.A-4.E 一周内做完（每天 2-3h），4.F 单独一天 + 24h 观察。

---

## 引用

- `server/_core/runtime/types.ts` —— RuntimeEvent 类型源
- `server/_core/runtime/event-normalizer.ts` —— normalize 实现（参考思路）
- `client/src/pages/Home.tsx:609+` —— 当前 WS handler
- `client/src/pages/Home.tsx:1091+` —— 当前 HTTP handler
- `client/src/_core/openclaw-ws-client.ts` —— 现有 WS 连接管理
- `docs/runtime/OPENCLAW_RUNTIME_BASELINE.md` 第 3 章 —— OpenClaw 表面对照
