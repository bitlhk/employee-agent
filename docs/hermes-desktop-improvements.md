# Hermes Desktop 借鉴文档

> 目的：对比 `/home/ubuntu/reference/hermes-desktop` 与本项目 employee-agent，
> 整理可借鉴的稳定性、可靠性、UI 丝滑度改进项。
>
> 本文档供 Claude Code / Codex 协作使用：
> - 每项均含 **源文件定位**、**核心代码**、**目标文件**、**实施状态**
> - 实施后在对应条目下追加 `**Done:**` 说明，或 `**Blocked:**` + 原因

---

## 状态总览

| # | 分类 | 改进项 | 优先级 | 状态 |
|---|------|--------|--------|------|
| 1 | 稳定性 | async effect `cancelled` flag | 高 | TODO |
| 2 | 稳定性 | 消息队列（发送时 agent 忙则入队） | 高 | TODO |
| 3 | 稳定性 | Stable callback refs 防流式重渲染 | 高 | TODO |
| 4 | 稳定性 | end-of-stream DB 对账 | 中 | TODO |
| 5 | 稳定性 | Pre-send 配置健康检查 | 中 | TODO |
| 6 | 稳定性 | ErrorBoundary Try Again（替代整页刷新） | 中 | TODO |
| 7 | UI | 消息入场动画 `messageIn` | 中 | TODO |
| 8 | UI | Avatar 分组（一个回合一个头像） | 中 | TODO |
| 9 | UI | `useChatScroll` 统一滚动逻辑 | 中 | TODO |
| 10 | UI | 打字指示器（三点 + toolProgress 文字） | 中 | TODO |
| 11 | UI | Context 窗口圆形进度表盘 | 低 | TODO |
| 12 | 工程 | 输入历史（上下箭头翻历史） | 低 | TODO |
| 13 | 工程 | 拖拽 dragCounter 防误触发 | 低 | TODO |
| 14 | 工程 | Session cache 增量同步 O(1) | 低 | TODO |

---

## 详细说明

---

### #1 async effect `cancelled` flag
**优先级：高 | 成本：极低**

**问题：** 组件 unmount 后 async 函数仍可能调用 `setState`，导致 React warning 甚至状态污染。

**Hermes 做法** — `src/renderer/src/screens/Chat/Chat.tsx:68-77`
```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const flag = await window.hermesAPI.isRemoteMode();
    if (!cancelled) setRemoteMode(flag);
  })();
  return () => { cancelled = true; };
}, []);
```

**需要修改的文件（employee-agent）：**
- `client/src/hooks/useLingxiaChat.ts` — `startRecovery` 内部的 `fetch` 回调
- `client/src/components/pages/ChatPage.tsx` — 任何 async useEffect
- `client/src/components/console/SessionList.tsx` — 列表加载逻辑
- `server/` 侧不涉及

**实施方式：** 每个 `useEffect` 内的 async IIFE 顶部加 `let cancelled = false`，所有 setState 前加 `if (!cancelled)`，cleanup 返回 `() => { cancelled = true; }`。

---

### #2 消息队列
**优先级：高**

**问题：** 用户在 agent 回复过程中发第二条消息时，员工 agent 行为不确定（可能丢失或报错）。

**Hermes 做法** — `src/renderer/src/screens/Chat/Chat.tsx:65-67, 249-273`
```ts
const queueRef = useRef<QueuedMessage[]>([]);
const [queuedCount, setQueuedCount] = useState(0);

// 发送时判断是否繁忙
const handleSubmitOrQueue = useCallback((text, attachments) => {
  if (isLoading) {
    queueRef.current.push({ text, attachments });
    setQueuedCount(queueRef.current.length);
    return;
  }
  void handleSendRef.current(text, attachments);
}, [isLoading]);

// isLoading 变为 false 时自动消费队列
useEffect(() => {
  if (isLoading) return;
  const next = queueRef.current.shift();
  if (!next) return;
  setQueuedCount(queueRef.current.length);
  handleSendRef.current(next.text, next.attachments, true).catch(() => {
    queueRef.current.unshift(next); // 失败放回队首
    setQueuedCount(queueRef.current.length);
  });
}, [isLoading]);
```
UI 展示：`{queuedCount > 0 && <div>{queuedCount} 条等待中</div>}`

**需要修改的文件：**
- `client/src/components/AIChatBox.tsx` 或 `client/src/hooks/useLingxiaChat.ts`
- 新增队列 state 和 drain effect
- 在 ChatInput submit handler 替换为 `handleSubmitOrQueue`

---

### #3 Stable callback refs 防流式重渲染
**优先级：高**

**问题：** `useLingxiaChat` 内的 `send/abort/dispatchEvent` 依赖 `messages` 等会频繁变化的值，导致 identity 每次都变，memo 包裹的子组件在每个 streaming chunk 都重渲染。

**Hermes 做法** — `src/renderer/src/screens/Chat/hooks/useChatActions.ts:62-67`
```ts
// 通过 ref 读取最新值，callback 不依赖它们
const messagesRef = useRef(messages);
const isLoadingRef = useRef(isLoading);
useEffect(() => {
  messagesRef.current = messages;
  isLoadingRef.current = isLoading;
}); // 无依赖数组 = 每次渲染后同步

// handleSend 的依赖数组不包含 messages/isLoading
const handleSend = useCallback(async (text) => {
  if (!skipLoadingCheck && isLoadingRef.current) return; // 读 ref
  ...
}, [localCommands, pushUser, onSessionStarted, sendToAgent, setIsLoading]);
```

同样，`Chat.tsx` 用 `handleSendRef` 保存最新的 handleSend：
```ts
const handleSendRef = useRef(actions.handleSend);
useEffect(() => { handleSendRef.current = actions.handleSend; });
// drain effect 用 handleSendRef.current(...) 而不是 actions.handleSend
```

**需要修改的文件：**
- `client/src/hooks/useLingxiaChat.ts` — `send` callback 的依赖数组
- `client/src/components/AIChatBox.tsx` — 传递给子组件的 handler refs

---

### #4 end-of-stream DB 对账（reconcileStreamedWithDb）
**优先级：中**

**问题：** 流结束时，tool_call/tool_result 等只写入 DB 不通过 stream 传递的行不会立即显示，需要用户切换页面触发刷新。

**Hermes 做法** — `src/renderer/src/screens/Chat/sessionHistory.ts:204`

流结束时（`onChatDone`）：
1. 调用 `getSessionMessages(sessionId)` 拿 DB 完整记录
2. 调用 `reconcileStreamedWithDb(prev, dbMessages)` 合并
3. 合并策略：用 `role:content前200字符` 或 `callId` 做 reconciliation key，找到已有流式消息则**保留其 React id**（防止 DOM 重挂），只补充 DB 独有的行

**需要修改的文件：**
- `client/src/hooks/useLingxiaChat.ts` — 在 `transport.done` / `transport.stream_end` 事件后触发 DB 对账
- 需要有对应的后端 API（类似 `GET /api/claw/session/:id/messages`）
- 新建 `client/src/lib/reconcile-streamed.ts`（纯函数，可单测）

**注：** employee-agent 已有 `transport.recovered` 机制处理 truncated 流，这是另一层补丁（针对截断），两者互补。

---

### #5 Pre-send 配置健康检查
**优先级：中**

**问题：** 用户发消息后才知道 API key 未配置，体验差。

**Hermes 做法** — `src/renderer/src/screens/Chat/Chat.tsx:92-118`
```ts
const [readiness, setReadiness] = useState({ ok: true });
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const r = await window.hermesAPI.validateChatReadiness(profile);
      if (!cancelled) setReadiness(r);
    } catch {
      if (!cancelled) setReadiness({ ok: true }); // fail-open：验证失败不阻塞发送
    }
  })();
  return () => { cancelled = true; };
}, [profile, modelConfig.currentModel, ...]);

// Send 按钮：disabled={!readiness.ok}
// 内联展示 readiness.message + readiness.fixLocation
```

另有 `ConfigHealthBanner`（`src/renderer/src/components/ConfigHealthBanner.tsx`）：
- 可关闭的 banner，显示配置错误/警告数量
- 按严重程度着色（error/warning/info）
- 点击"查看详情"跳转到设置页
- 用 `localStorage` 记住用户已关闭状态，配置更新后重新出现

**需要修改的文件：**
- `client/src/components/AIChatBox.tsx` 或 `client/src/components/ChatInput.tsx` — 加 readiness check
- `server/` — 提供 `GET /api/claw/readiness` 端点（检查 adoptId 对应的 agent 配置是否完整）
- 新增 `client/src/components/ConfigHealthBanner.tsx`

---

### #6 ErrorBoundary Try Again
**优先级：中 | 成本：极低**

**当前问题：** `client/src/components/ErrorBoundary.tsx` 只有 `window.location.reload()`，整页刷新丢失上下文。

**Hermes 做法** — `src/renderer/src/components/ErrorBoundary.tsx:43-47`
```ts
<button onClick={() => this.setState({ hasError: false, error: null })}>
  Try Again
</button>
```
只重置 ErrorBoundary state，让 React 重新尝试渲染子树，不刷页。

**需要修改的文件：**
- `client/src/components/ErrorBoundary.tsx`
- 把 `window.location.reload()` 改为 `this.setState({ hasError: false, error: null })`
- 保留 "Reload Page" 作为第二个按钮（兜底）

---

### #7 消息入场动画
**优先级：中 | 成本：极低**

**Hermes 做法** — `src/renderer/src/assets/main.css:2005-2015`
```css
.chat-message {
  animation: messageIn 0.2s ease;
}
@keyframes messageIn {
  from { opacity: 0.4; transform: translateY(4px); }
  to   { opacity: 1;   transform: translateY(0); }
}
```
每条新气泡从下方 4px 淡入，持续 0.2s，是"丝滑感"的核心来源。

**需要修改的文件：**
- `client/src/index.css` — 在聊天气泡容器 class 上加 animation

**注意：** streaming 期间内容不断追加，animation 只应在气泡**首次出现**时触发，不应在内容更新时重复。确保 key 不变即可（React 不会重挂已有组件）。

---

### #8 Avatar 分组（一个回合一个头像）
**优先级：中**

**问题：** 当一个 agent 回合包含多条 tool call 卡片时，每条都有头像，视觉拥挤。

**Hermes 做法** — `src/renderer/src/screens/Chat/MessageList.tsx:77-79`
```ts
const prev = visibleMessages[i - 1];
const showAvatar = !prev || prev.role !== msg.role;
// showAvatar=false 时渲染 <AvatarSpacer />（同宽占位，内容列对齐）
```
`AvatarSpacer` 是一个 `aria-hidden` 的空 div，宽度与头像相同，保证内容列对齐。

**需要修改的文件：**
- `client/src/components/ChatMessage.tsx` — 接受 `showAvatar` prop
- `client/src/components/AIChatBox.tsx` — 消息列表遍历时计算并传入 `showAvatar`

---

### #9 useChatScroll 统一滚动逻辑
**优先级：中**

**问题：** employee-agent 的自动滚动分散在多处，逻辑不一致。

**Hermes 做法** — `src/renderer/src/screens/Chat/hooks/useChatScroll.ts`
```ts
export function useChatScroll(messages) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);       // 放在消息列表底部的哨兵元素
  const userScrolledUpRef = useRef(false);

  // 监听滚动：距底部 <60px 则视为"在底部"
  useEffect(() => {
    const el = containerRef.current;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 消息变化时滚动：用户刚发消息则强制滚动（忽略 scrolledUp 状态）
  useEffect(() => {
    const userJustSent = messages[messages.length-1]?.role === "user";
    if (userJustSent) {
      userScrolledUpRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (!userScrolledUpRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return { containerRef, bottomRef };
}
```

**需要修改的文件：**
- 新建 `client/src/hooks/useChatScroll.ts`
- `client/src/components/AIChatBox.tsx` — 替换现有滚动逻辑

---

### #10 打字指示器（TypingIndicator）
**优先级：中 | 成本：低**

**Hermes 做法** — `src/renderer/src/screens/Chat/MessageList.tsx:14-35`

两种状态：
1. `isLoading && !toolProgress` → 三点跳动动画气泡
2. `isLoading && toolProgress && lastMessageIsAgent` → 在最后一条 agent 消息下方显示工具进度文字（如 `"正在调用 web_search..."`）

CSS（`main.css:2367-2375`）：
```css
.chat-typing-dot { animation: typingBounce 1.4s infinite; }
.chat-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.chat-typing-dot:nth-child(3) { animation-delay: 0.4s; }
```

**需要修改的文件：**
- `client/src/components/AIChatBox.tsx` 或 `client/src/components/ChatMessage.tsx`
- `client/src/index.css` — 加 typingBounce keyframe

---

### #11 Context 窗口圆形进度表盘
**优先级：低**

**Hermes 做法** — `src/renderer/src/screens/Chat/ContextGauge.tsx`

SVG 圆环，hover 展示 tooltip（用了多少 token，cache read/write 比例）。employee-agent 的 `ChatMessage.tsx` 已有 `contextPercent` 字段，但只是文字显示。

**需要修改的文件：**
- 新建 `client/src/components/ContextGauge.tsx`（直接参考 Hermes 实现，约 100 行）
- `client/src/components/AIChatBox.tsx` — 在输入框工具栏区域引入

---

### #12 输入历史（上下箭头翻历史）
**优先级：低**

**Hermes 做法** — `src/renderer/src/screens/Chat/hooks/useInputHistory.ts`

用 `sessionStorage` 存最近 50 条发送内容，↑/↓ 键在历史中导航，ESC 退出历史模式。

**需要修改的文件：**
- 新建 `client/src/hooks/useInputHistory.ts`
- `client/src/components/ChatInput.tsx` — 绑定键盘事件

---

### #13 拖拽 dragCounter 防误触发
**优先级：低**

**问题：** 拖拽文件经过子元素边界时，`dragLeave` 会错误触发导致拖拽高亮闪烁。

**Hermes 做法** — `src/renderer/src/screens/Chat/Chat.tsx:63`
```ts
const dragCounter = useRef(0);

onDragEnter: dragCounter.current += 1; if (dragCounter.current === 1) setDragActive(true);
onDragLeave: dragCounter.current = Math.max(0, dragCounter.current - 1);
             if (dragCounter.current === 0) setDragActive(false);
onDrop:      dragCounter.current = 0; setDragActive(false);
```
同时过滤非文件类型的拖拽（检查 `e.dataTransfer.types` 包含 `"Files"`）。

**需要修改的文件：**
- `client/src/components/AIChatBox.tsx` — 替换现有 drag handler

---

### #14 Session cache 增量同步 O(1)
**优先级：低**

**问题：** 大量 session 时（数千条），每次列表更新可能产生 O(N²) 查找。

**Hermes 做法** — `src/main/session-cache.ts:122-127`
```ts
const existingById = new Map<string, CachedSession>();
for (const s of cache.sessions) existingById.set(s.id, s);
// 之后所有查找都是 O(1)

// SQLite IN 查询按 500 条分块
const CHUNK = 500;
for (let i = 0; i < staleIds.length; i += CHUNK) {
  const chunk = staleIds.slice(i, i + CHUNK);
  ...
}
```

**需要修改的文件：**
- `server/` 侧 session 列表相关查询逻辑

---

## 讨论区

> 在此追加讨论，格式：`**[作者] [日期]:** 内容`

**[Claude] 2026-06-06:** 文档初始化完成。#1/#2/#3 建议作为第一批实施，改动最小但收益最高。#7（消息入场动画）和 #9（useChatScroll）可以一起做，都在前端 UI 层，互不依赖。
