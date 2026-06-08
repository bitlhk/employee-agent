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
| 1 | 稳定性 | async effect `cancelled` flag | 高 | DONE |
| 2 | 稳定性 | 消息队列（发送时 agent 忙则入队） | 高 | DEFER |
| 3 | 稳定性 | Stable callback refs 防流式重渲染 | 高 | N/A |
| 4 | 稳定性 | end-of-stream DB 对账 | 中 | DONE |
| 5 | 稳定性 | Pre-send 配置健康检查 | 中 | DEFER |
| 6 | 稳定性 | ErrorBoundary Try Again（替代整页刷新） | 中 | DONE |
| 7 | UI | 消息入场动画 `messageIn` | 中 | DONE |
| 8 | UI | Avatar 分组（一个回合一个头像） | 中 | DEFER |
| 9 | UI | `useChatScroll` 统一滚动逻辑 | 中 | DONE |
| 10 | UI | 打字指示器（三点 + toolProgress 文字） | 中 | DONE |
| 11 | UI | Context 窗口圆形进度表盘（ContextGauge） | 低 | DEFER |
| 12 | 工程 | 输入历史（上下箭头翻历史） | 低 | DONE |
| 13 | 工程 | 拖拽 dragCounter 防误触发 | 低 | N/A |
| 14 | 工程 | Session cache 增量同步 O(1) | 低 | DEFER |
| 15 | 稳定性 | `handleNewChat` 先 abort 再 clear | 高 | DONE |
| 16 | 稳定性 | `safeWriteFile` 原子写（tmp → rename） | 中 | DEFER |
| 17 | UI | Tab 懒挂载 + `visitedViews` 保活 | 高 | DONE |
| 18 | UI | Slash 命令面板（`/` 触发，键盘导航） | 中 | DEFER |
| 19 | UI | Markdown 代码块懒加载高亮 + 复制按钮 | 中 | DEFER |
| 20 | UI | Markdown 链接安全验证 | 中 | DONE |
| 21 | UI | diff 代码块专用渲染（+/-/@@行着色） | 低 | N/A |
| 22 | UI | Session 列表日期分组 + 全文检索防竞态 | 中 | N/A |
| 23 | UI | Slash 面板 click-outside 关闭 + 滚动到激活项 | 中 | N/A |
| 24 | UI | `requestAnimationFrame` 延迟 textarea 自动高度计算 | 低 | DONE |
| 25 | 稳定性 | 图片附件客户端自动压缩 | 高 | DONE |
| 26 | 稳定性 | 流结束后 input 自动重聚焦 | 低 | DONE |
| 27 | 工程 | 启动时后台深度验证（不阻塞 UI） | 中 | N/A |
| 28 | 工程 | `cleanLeakedToolTags` 清理泄漏标签 | 中 | DONE |
| 29 | 工程 | MediaSegment 用字符偏移量作 React key | 中 | N/A |
| 30 | 稳定性 | 流式 watchdog 防静默断连卡死 | 高 | DONE |
| 31 | 稳定性 | 消息列表使用稳定 React key | 高 | DONE |
| 32 | 稳定性 | IME guard（中文输入 Enter 误发送） | 高 | DONE |
| 33 | 性能 | parseMediaTokens/cleanLeakedToolTags useMemo 缓存 | 高 | DONE |
| 34 | 稳定性 | 图片粘贴路径补压缩（paste 未走 prepareChatAttachments） | 中 | DONE |
| 35 | UI | 语音输入实时转录反馈（SpeechRecognition + 2.5s interim） | 低 | DEFER |
| 36 | 安全 | Markdown `<img>` 协议 + 格式安全验证 | 中 | DONE |
| 37 | UI | Settings 保存反馈（"Saved" 2s fade） | 低 | DEFER |
| 38 | 工程 | 对话内容导出（纯文本 / Markdown） | 低 | DONE |
| 39 | 性能 | `activeToolElapsed` 提取为子组件，消除工具执行期间每秒全树重渲染 | 中 | DONE |
| 40 | 性能 | `startTransition` 包裹流式 `setMessages`，防止 streaming 抢占用户交互 | 中 | DONE |
| 41 | 稳定性 | 老 SSE 路径超时后 `lingxiaStreaming` 未自动清除（`chatV2Enabled=false` 时） | 低 | DONE |
| 42 | UI | 文件拖拽上传（drag-to-attach + 全屏遮罩提示） | 高 | DONE |
| 43 | UI | 图片附件发送前缩略图预览（当前只显示文件名） | 中 | DONE |
| 44 | UI | 消息内图片点击放大 lightbox | 中 | DEFER |
| 45 | UI | 空对话建议词 chips（快速填充输入框） | 低 | DEFER |

### 剩余项优先级（2026-06-06 复核，含第八轮新增）

**P0 / 下一批建议做**
- 暂无。当前主聊天稳定性和高频输入体验的高优项已经清零。

**P1 / 有价值但先观察**
- **#5 Pre-send 配置健康检查**：当前已有健康检查、readiness banner 和诊断信息；暂不建议再做“发送前硬拦截”，否则慢链路/临时失败会误伤用户。后续如果 API key/模型未配置类投诉增加，再把健康检查前置到发送按钮。
- **#14 Session cache 增量同步 O(1)**：现在会话规模还没有到数千级，且已有 summary cache。等历史会话明显变慢再做。
- **#16 safeWriteFile 原子写**：值得长期做，但当前高频状态和业务数据主要走 DB/受控写入；OpenClaw 配置写入不是当前故障热点。
- **#18 Slash 命令面板**：power user 体验项，当前中文办公用户未必需要；如后续命令体系变多再做。
- **#19 Markdown 代码块懒加载高亮**：代码块复制按钮已经有，剩余主要是懒加载高亮。除非 bundle/首屏性能数据显示 `rehype-highlight` 成本明显，否则先不动。
- **#35 语音输入实时转录反馈**：当前已有录音后转写，实时 interim 是体验增强，不是主链路稳定性问题。
- **#37 Settings 保存反馈**：当前设置保存已有 toast 成功提示；Hermes 式右上角 2 秒 chip 是轻量美化，不影响正确性，可等设置页整体打磨时一起做。

**Closed / 暂不做**
- **#3 Stable callback refs**：Claude 原始假设不完全成立；`useLingxiaChat.send` 不依赖 `messages`，核心重渲染问题已通过稳定 key、passive scroll、watchdog、memo 等实际热点处理。后续如果要优化，应拆 `Home.tsx`，不是照搬 callback-ref 模式。
- **#8 Avatar 分组**：视觉偏好项。当前透明工具摘要 + 气泡布局更符合现有风格，强行分组可能减少信息定位清晰度。
- **#11 ContextGauge**：圆形表盘本身是纯展示，没有配套行动（如接近上限时引导开新会话）的话，跟现有文字 chip 没有本质区别。等后续做"上下文快满自动提示"功能时一起做。
- **#13 dragCounter**：主聊天没有完整拖拽上传入口，当前风险不成立。
- **#21 diff 代码块专用渲染**：员工智能体不是代码 review 主场景，普通代码块已可复制和高亮，收益低。
- **#23 Slash 面板细节**：依赖 #18；#18 暂缓时该项关闭。
- **#27 启动后台深度验证**：当前首屏已有非阻塞诊断和 readiness banner，不需要再加一套 Hermes 桌面安装验证。
- **#29 MediaSegment key**：当前主聊天没有 Hermes 那套 `MEDIA:` segment 渲染链，问题不成立。
- **#44 消息内图片 lightbox**：暂时不做。当前已有安全图片渲染和发送前缩略图，lightbox 需要额外处理移动端手势、Markdown 图片链接冲突和安全边界；等用户明确反馈“图片看不清”再进入下一批。
- **#45 空对话建议词 chips**：暂时不做。通用建议词在员工办公场景容易偏消费化，也会干扰用户直接输入任务；如后续需要，应按岗位/场景配置，而不是放固定通用 chips。

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

**Done 2026-06-06:** `client/src/hooks/useLingxiaChat.ts` 增加 `isMountedRef`，在 hook cleanup 时置为 `false`，并在 `dispatchEvent()` 入口做 no-op 防护。这样 recovery/status fetch 或 transport 回调即使在组件卸载后返回，也不会继续触发 `setMessages()` / `setIsStreaming()`。当前没有批量改所有页面级 async effect，避免扩大变更面；后续可按 React warning 再逐个补。

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

**Deferred 2026-06-06:** 主聊天当前已通过 `isStreaming`/按钮禁用避免并发发送。直接引入自动队列会改变用户交互语义：用户以为“立即发送”，实际会排到上一轮完成后执行，且 OpenClaw 会话、工具调用和历史保存可能出现顺序争议。建议先做产品确认：忙碌期间是继续禁用、允许“排队发送”，还是允许用户取消上一轮后发送。

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

**Deferred 2026-06-06:** `useLingxiaChat` 当前已经用 `messagesRef` 保存最新消息，并且 `send` 没直接依赖 `messages`；主聊天主要渲染逻辑在 `Home.tsx`，不是文档里提到的通用 `AIChatBox.tsx`。如果继续做，需要先用 React profiler 或日志确认 streaming chunk 是否真的造成关键子树重复重渲染，再针对实际热点拆 memo/ref，否则容易做成无收益重构。

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

**Done 2026-06-06:** `client/src/components/ErrorBoundary.tsx` 已增加 `Try Again`，点击后只重置 ErrorBoundary state 并重新渲染子树；同时保留 `Reload Page` 作为兜底刷新入口。

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

### #11 Context 窗口圆形进度表盘（ContextGauge）
**优先级：低 | 状态：TODO**

**问题：** 当前输入框下方状态栏把上下文占用率展示为纯文字 chip（`上下文 XX%`），不够直观，接近上限时用户很难一眼感知。

**Hermes 做法** — `src/renderer/src/screens/Chat/ContextGauge.tsx`

SVG 圆环（size=26, stroke=3, radius=11.5），fill 用 `strokeDasharray` 控制填充弧度，数字居中显示，hover/focus 弹出 tooltip 含：已用%、已用/总 token 数、cache read/write 命中率。

```tsx
// 核心几何：
const circumference = 2 * Math.PI * radius;          // ≈72.26
const filled = (pct / 100) * circumference;
// SVG 圆弧：
<circle
  strokeDasharray={`${filled} ${circumference}`}
  transform={`rotate(-90 ${size/2} ${size/2})`}     // 从12点钟方向开始
/>
```

**employee-agent 数据来源：**
- `latestContextMessage.contextPercent` — 已计算的百分比（0-100）
- `latestContextMessage.usage.input` — 输入 token 数
- `latestContextMessage.contextWindow` — 模型总窗口大小
- 这三个字段已经通过 `__perf` chunk 填入消息对象（`Home.tsx:1984-1988`）

**实施步骤：**

1. **新建 `client/src/components/ContextGauge.tsx`**，参考 Hermes 实现，props：
   ```ts
   interface ContextGaugeProps {
     pct: number;           // 0-100
     usedTokens?: number;
     windowTokens?: number;
   }
   ```
   SVG 圆环 + 中央数字 + hover tooltip。`pct >= 80` 时 fill 改 `var(--oc-warning, #f59e0b)`。用 `memo` 包裹。

2. **修改 `client/src/pages/Home.tsx`**，在 `statusExtras` 渲染处（约第 3259 行），对 `key === "context"` 的 chip 改为渲染 `<ContextGauge>`：
   ```tsx
   statusExtras={chatComposerStatus.map((item) =>
     item.key === "context" ? (
       <ContextGauge
         key="context"
         pct={latestContextMessage?.contextPercent ?? 0}
         usedTokens={latestContextMessage?.usage?.input}
         windowTokens={latestContextMessage?.contextWindow}
       />
     ) : (
       <span key={item.key} className="lingxia-composer-status-chip" data-tone={item.tone || "muted"}>
         {item.label}
       </span>
     )
   )}
   ```
   同时移除 `chatComposerStatus` 中 key=`"tokens"` 的 fallback chip（原始 token 数对用户无意义）。

3. **在 `client/src/index.css`** 添加样式（参考 Hermes `main.css:2593-2660`）：
   ```css
   .lingxia-ctx-gauge { position: relative; width: 30px; height: 30px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: default; outline: none; }
   .lingxia-ctx-gauge-track { stroke: var(--oc-border); }
   .lingxia-ctx-gauge-fill { stroke: var(--oc-accent); transition: stroke-dasharray 0.3s ease; }
   .lingxia-ctx-gauge-fill.is-warning { stroke: var(--oc-warning, #f59e0b); }
   .lingxia-ctx-gauge-num { position: absolute; font-size: 9px; font-weight: 600; color: var(--oc-text-secondary); font-variant-numeric: tabular-nums; }
   .lingxia-ctx-tooltip { /* 参考 Hermes chat-ctx-tooltip，position:absolute; bottom:calc(100%+8px); right:0; opacity:0 → hover opacity:1 */ }
   ```

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

### #15 `handleNewChat` 先 abort 再 clear
**优先级：高 | 成本：极低**

**问题：** 点击"新对话"时，如果当前有 in-flight 请求，IPC/transport 回调可能在 `setMessages([])` 之后继续追加消息到已清空的状态，产生"幽灵消息"。

**Hermes 做法** — `src/renderer/src/screens/Layout/Layout.tsx:192-198`
```ts
const handleNewChat = useCallback(() => {
  window.hermesAPI.abortChat();   // ← 先中止
  setMessages([]);
  setCurrentSessionId(null);
  goTo("chat");
}, [goTo]);
```

**需要修改的文件：**
- `client/src/components/AIChatBox.tsx` 或调用 `clear()` 的入口 — 确保 `abort()` 在 `setMessages([])` / `clear()` 之前调用

---

### #16 `safeWriteFile` 原子写（tmp → rename）
**优先级：中**

**问题：** 直接 `writeFileSync(path, content)` 在写一半时进程崩溃会产生损坏的配置文件。

**Hermes 做法** — `src/main/utils.ts:198-220`
```ts
export function safeWriteFile(filePath: string, content: string): void {
  const tempPath = join(dir, `.${basename}.${pid}.${Date.now()}.${rand}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, filePath);   // 原子替换
  // 失败时 cleanup tempPath
}
```
rename 是 POSIX 原子操作，即使进程在 rename 之前崩溃，原始文件完好无损。

**需要修改的文件：**
- `server/src/` 中所有直接写配置/状态文件的地方，替换为原子写

---

### #17 Tab 懒挂载 + `visitedViews` 保活
**优先级：高**

**问题：** employee-agent 的 Sidebar tab 切换很可能重新挂载组件，导致 IPC 重连、数据重拉取，切换时有明显延迟。

**Hermes 做法** — `src/renderer/src/screens/Layout/Layout.tsx:93-110`
```ts
// 只在首次访问时挂载，之后用 display:none 切换
const [visitedViews, setVisitedViews] = useState<Set<View>>(
  () => new Set<View>(["chat"]) // chat 立即挂载
);

const goTo = useCallback((v: View) => {
  setVisitedViews((prev) => prev.has(v) ? prev : new Set(prev).add(v));
  setView(v);
}, []);

// JSX:
{visitedViews.has("sessions") && (
  <div style={{ display: view === "sessions" ? "flex" : "none", ... }}>
    <Sessions ... />
  </div>
)}
```
核心优点：
- 首次点击 tab 才挂载（节省初始加载）
- 之后切换用 `display:none`，组件保活，WebSocket 连接不断，state 不丢失

**需要修改的文件：**
- `client/src/components/console/MainPanel.tsx` — 已确认使用纯条件渲染（`if (activePage === "weixin") content = <ChannelsPage />`），每次切 tab 完全重挂载
- 改法：在 `MainPanel.tsx` 引入 `visitedPages` state，已访问过的 tab 用 `display:none` 切换而非 unmount

**已确认重挂载证据（2026-06-06）：**
`MainPanel.tsx` 直接 `if/else` 赋值 `content`，切 tab 时旧组件彻底销毁，新组件从零挂载。例如 `ChannelsPage` 每次切回都重新建立 WS 连接、重拉频道列表。

**Done 2026-06-06:** `client/src/components/console/MainPanel.tsx` 已改为 `visitedPages` 保活模式。首次进入某个非聊天 tab 时才挂载页面，之后使用 `display:none` 隐藏而不是 unmount；每个页面保留独立 `PanelErrorBoundary`，切换员工智能体（`adoptId` 变化）时用 page/adoptId key 重新挂载，避免跨智能体保留旧状态。

---

### #18 Slash 命令面板（`/` 触发，键盘导航）
**优先级：中**

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatInput.tsx:232-332` + `slashCommands.ts`

- 输入 `/` 开头时弹出命令面板，`/word` 实时过滤
- 支持分类：chat（本地执行）/ agent（发后端）/ tools / info
- 键盘：↑↓ 导航，Enter/Tab 选中，Esc 关闭
- 本地命令（`local: true`）立即执行，不发网络
- 后端命令插入前缀等用户补充参数

`slashCommands.ts` 定义了完整的命令列表（25 条），包括 `/compact`、`/goal`、`/steer`、`/queue` 等高级命令。

**需要修改的文件：**
- `client/src/components/ChatInput.tsx` — 加 slash 检测 + 面板渲染
- 新建 `client/src/config/slashCommands.ts` — 命令注册表
- 本地命令处理函数（参考 `useLocalCommands`）

---

### #19 Markdown 代码块懒加载高亮 + 复制按钮
**优先级：中**

**问题：** `react-syntax-highlighter` 包很大（~400KB），首次渲染时同步加载会阻塞。

**Hermes 做法** — `src/renderer/src/components/AgentMarkdown.tsx:10-25`
```ts
let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _loadingPromise: Promise<void> | null = null;

function loadHighlighter(): Promise<void> {
  if (_highlighterMod) return Promise.resolve(); // 已加载
  if (_loadingPromise) return _loadingPromise;   // 加载中
  _loadingPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([mod, style]) => { _highlighterMod = mod; _oneDark = style.default; });
  return _loadingPromise;
}
```
模块级缓存（非组件级），首个代码块 mount 时触发加载，后续复用。加载期间 fallback 为 `<pre>` 纯文本（无 FOUC，无骨架闪烁）。

另外每个代码块有**复制按钮**（`Copy` icon，点击后 2s 内显示 "Copied" 反馈）。

employee-agent 的 `ChatMarkdown.tsx` 里需要确认是否已有类似实现，如没有则参考此方案改造。

**需要修改的文件：**
- `client/src/components/ChatMarkdown.tsx`

---

### #20 Markdown 链接安全验证
**优先级：中 | 成本：极低**

**问题：** 渲染器直接执行 agent 返回的链接，可能触发 `javascript:` 或自定义协议注入。

**Hermes 做法** — `src/renderer/src/components/AgentMarkdown.tsx:139-153`
```ts
a: ({ href }) => (
  <a onClick={(e) => {
    e.preventDefault();
    try {
      const url = new URL(href, "https://placeholder.invalid");
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return; // 拦截
    } catch { return; }
    window.hermesAPI.openExternal(href);
  }}>
```
**需要修改的文件：**
- `client/src/components/ChatMarkdown.tsx` — 在 `a` 组件里加协议白名单校验

---

### #21 diff 代码块专用渲染
**优先级：低 | 成本：低**

**Hermes 做法** — `src/renderer/src/components/AgentMarkdown.tsx:28-45`
```ts
function DiffView({ code }): JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";    // 绿色
        else if (line.startsWith("-")) cls += " chat-diff-remove"; // 红色
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";  // 灰色
        return <div key={i} className={cls}>{line || " "}</div>;
      })}
    </div>
  );
}
```
检测 ` ```diff ` 语言标记，用专用视图代替语法高亮器，无需等待懒加载。

**需要修改的文件：**
- `client/src/components/ChatMarkdown.tsx`

---

### #22 Session 列表日期分组 + 全文检索防竞态
**优先级：中**

**Hermes 做法** — `src/renderer/src/screens/Sessions/Sessions.tsx`

**日期分组：**
```ts
type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";
function groupSessions(sessions): Array<{ label: DateGroup; sessions[] }> { ... }
```

**防竞态 debounce 搜索：**
```ts
const searchRequestId = useRef(0);
// 每次触发时递增 requestId，结果返回时对比，过期的直接丢弃
const requestId = ++searchRequestId.current;
setTimeout(async () => {
  const results = await search(query);
  if (searchRequestId.current !== requestId) return; // 竞态：丢弃
  setSearchResults(results);
}, 300);
```

**搜索结果高亮：** `<mark>` 标签包裹命中片段，`cleanSearchSnippet` 清理 markdown 格式再展示。

**需要修改的文件：**
- `client/src/components/console/SessionList.tsx` — 加日期分组和防竞态 requestId

---

### #23 Slash 面板 click-outside 关闭 + 滚动到激活项
**优先级：中 | 成本：低**

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatInput.tsx:207-230`
```ts
// Click outside: mousedown 不是 click，防止 textarea blur 先于关闭
useEffect(() => {
  if (!slashMenuOpen) return;
  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
}, [slashMenuOpen]);

// 键盘导航时滚动激活项入视口
useEffect(() => {
  if (!slashMenuOpen) return;
  slashMenuRef.current?.querySelector(".slash-menu-item-active")
    ?.scrollIntoView({ block: "nearest" });
}, [slashSelectedIndex, slashMenuOpen]);
```

---

### #24 `requestAnimationFrame` 延迟 textarea 高度计算
**优先级：低 | 成本：极低**

**问题：** 直接读 `scrollHeight` 时 DOM 可能未完成 layout，导致高度计算不准。

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatInput.tsx:288-292`
```ts
function handleInputChange(e) {
  setInput(e.target.value);
  const target = e.target;
  requestAnimationFrame(() => {     // ← 延迟到下一帧
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  });
}
```

---

### #25 图片附件客户端自动压缩
**优先级：高**

**问题：** 大图片（>7MB）经 base64 编码后超过后端 10MB JSON body 限制，导致神秘的 "Invalid JSON in request body" 错误。

**Hermes 做法** — `src/renderer/src/screens/Chat/attachmentUtils.ts:155-270`

```ts
export async function compressImageToFit(file: File, targetBytes: number): Promise<File> {
  if (file.size <= targetBytes) return file; // 快速路径：无需处理

  // GIF 动画直接拒绝（canvas 只捕获第一帧）
  if (file.type === "image/gif" && file.size > targetBytes) throw new Error("image-uncompressible");

  // 检测透明度（采样 10000 像素点，避免全图扫描）
  const hasAlpha = canvasHasTransparency(canvas);

  // 压缩策略：
  // - 有透明度 → 只用 PNG（lossless，保留透明）
  // - 无透明度 → WebP + JPEG 都试，取更小的
  // - 先降 quality（0.9→0.5），再降分辨率（每次缩 20%）
}
```

透明度检测用 stride 采样（`stepX = width/100`），只采 10k 点而非全图 N²。

**需要修改的文件：**
- 新建 `client/src/lib/attachment-compress.ts`（纯函数，可单测）
- `client/src/components/ChatInput.tsx` — 文件选择/粘贴后调用压缩

---

### #26 流结束后 input 自动重聚焦
**优先级：低 | 成本：极低**

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatInput.tsx:202-205`
```ts
useEffect(() => {
  if (!isLoading) inputRef.current?.focus();
}, [isLoading]);
```
`isLoading` 从 `true` 变 `false` 时（流结束或 abort）自动把焦点归还输入框，用户无需点击即可继续输入。

**需要修改的文件：**
- `client/src/components/ChatInput.tsx` — 加此 effect

---

### #27 启动时后台深度验证（不阻塞 UI）
**优先级：中**

**问题：** 启动时如果深度检查（Python 可用性、脚本健康）放到前台，慢速机器上会显著拖慢首屏。

**Hermes 做法** — `src/renderer/src/App.tsx:82-96`
```ts
// checkInstall() 只检查文件是否存在（快）
// verifyInstall() 实际运行 Python 探测（慢）

// 快检通过后立即显示 UI
setScreen("main");

// 慢检在后台异步跑，失败只显示 warning banner，不回退到 Welcome 页
window.hermesAPI.verifyInstall().then((ok) => {
  if (!ok) setVerifyWarning(true); // 降级为软警告，不阻塞
});
```

另外，Splash Screen 有 **最小显示时间** `SPLASH_MIN_MS = 1300ms`，保证品牌动画完整播放，即使检查很快也不会"一闪而过"。

**需要修改的文件：**
- `client/src/App.tsx` 或启动检查逻辑 — 把慢速健康检查从关键路径移出

---

### #28 `cleanLeakedToolTags` 清理泄漏标签
**优先级：中**

**问题：** 模型有时会把工具调用以 `<tool_name>{...}</tool_name>` XML 格式泄漏到文本流里，直接渲染成 Markdown 会显示奇怪的 HTML 或乱码。

**Hermes 做法** — `src/renderer/src/screens/Chat/mediaUtils.ts:272`
```ts
export function cleanLeakedToolTags(content: string): string {
  // 检测 snake_case 标签名（如 <web_search>）→ 认定为泄漏工具调用
  // 提取 body 内的 JSON，转为人类可读文本
  // 非泄漏标签（单词 HTML 元素）原样保留
}
```
在 `MessageRow` 渲染前调用：`parseMediaTokens(cleanLeakedToolTags(bubbleContent))`。

**需要修改的文件：**
- `client/src/components/ChatMessage.tsx` — 在渲染 agent 消息前调用清理函数
- 新建 `client/src/lib/clean-leaked-tags.ts`

---

### #29 MediaSegment 用字符偏移量作 React key
**优先级：中**

**问题：** 流式渲染中，`MEDIA:` token 出现在文本中间时，后面所有文本段的数组 index 都会发生偏移，导致 React 认为每个段都是新元素，重新挂载 `MediaSegmentView`，重复触发文件存在性检查请求。

**Hermes 做法** — `src/renderer/src/screens/Chat/MessageRow.tsx:139-154`
```ts
segments.map((segment) =>
  segment.type === "text" ? (
    // key 用字符偏移量，不用 index
    <AgentMarkdown key={`t-${segment.start}`}>
      {segment.value}
    </AgentMarkdown>
  ) : (
    <MediaSegmentView
      key={`m-${segment.start}`}  // ← start 是原始字符串中的偏移，不随其他段变动
      ...
    />
  )
)
```

**需要修改的文件：**
- `client/src/components/ChatMessage.tsx` — 确保 media 段的 React key 用稳定标识符（内容 hash 或偏移量）而非 index

---

### #32 IME guard（中文/日文输入 Enter 误发送）
**优先级：高 | 成本：极低（1 行）**

**问题：** 用户用拼音/五笔/日文输入法打字，按 Enter 选词确认时，`ChatInput` 会误判为"发送"，把半截拼音/假名直接发出去。对 CJK 用户是必现 bug。

**Hermes 做法** — `src/renderer/src/screens/Chat/keyboard.ts`
```ts
export function isImeComposing(e: ImeKeyEvent): boolean {
  return Boolean(e.nativeEvent.isComposing || e.keyCode === 229);
  // 229 是旧版 Chromium/Electron 的 IME fallback keyCode
}
// ChatInput.tsx 用法：
if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
  void handleSend();
}
```

**employee-agent 现状** — `client/src/components/ChatInput.tsx`
```ts
if (e.key === "Enter" && !e.shiftKey) {
  e.preventDefault();
  void submitMessage();  // ← 没有 IME 检查，CJK 输入必现误发
}
```

**需要修改的文件：**
- `client/src/components/ChatInput.tsx` — `onKeyDown` 的 Enter 分支加 `&& !e.nativeEvent.isComposing`

**Done 2026-06-06:** `client/src/components/ChatInput.tsx` 已在 `onKeyDown` 入口增加 `e.nativeEvent.isComposing || e.keyCode === 229` guard。实现放在快捷键分支之前，因此不仅阻止 Enter 误发送，也阻止输入法组合态下误触发 @mention 的 Enter/Tab 选择。

---

### #33 parseMediaTokens / cleanLeakedToolTags 每帧重跑（O(n²) streaming）
**优先级：高 | 成本：低（useMemo 包裹）**

**问题：** Streaming 期间每个 chunk 触发 ChatMessage 重渲染，`cleanLeakedToolTags(text)` 在组件 render 里直接执行（无缓存），随消息越来越长，每帧重跑完整 regex 管道，总开销是 O(n²)。

**Hermes 做法** — `src/renderer/src/screens/Chat/MessageRow.tsx:74-85`
```ts
const segments = useMemo(
  () =>
    msg.role === "agent" && bubbleContent
      ? parseMediaTokens(cleanLeakedToolTags(bubbleContent))
      : null,
  [msg.role, bubbleContent],   // content 不变就不重跑
);
```
memo 粒度在单条消息内，content 不变时直接复用上次结果。

**employee-agent 现状** — `client/src/components/ChatMessage.tsx:554`
```ts
const displayText = cleanLeakedToolTags(text);  // 每次 render 都跑
```

**需要修改的文件：**
- `client/src/components/ChatMessage.tsx` — 用 `useMemo(() => cleanLeakedToolTags(text), [text])` 替换直接调用

**Done 2026-06-06:** `client/src/components/ChatMessage.tsx` 已引入 `useMemo`，将 `displayText` 改为 `useMemo(() => cleanLeakedToolTags(text), [text])`。这不会消除新 token 到来时必须清理新文本的成本，但能避免同一文本在父组件状态变化、工具卡片变化、复制按钮状态变化等非文本渲染中重复跑 regex 清理。

---

### #34 图片粘贴路径未压缩
**优先级：中**

**问题：** `prepareChatAttachments` 只在 `handleFileSelect`（文件选择器回调）里调用。用户直接粘贴截图（`Ctrl+V` / `Cmd+V`）时，大图不经压缩直接进附件列表，与 file-select 路径行为不一致，仍可能触发大图 JSON 超限错误。

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatInput.tsx`
```ts
function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
  const { files } = filesFromClipboard(e);
  if (files.length === 0) return;
  e.preventDefault();
  void ingestFiles(files);  // ingestFiles 内部走同一套 compress 逻辑
}
```

**需要修改的文件：**
- `client/src/components/ChatInput.tsx` — 加 `onPaste` handler，检测 `e.clipboardData.files`，对图片文件调用 `prepareChatAttachments` 后再 `setAttachments`

**Done 2026-06-06:** `client/src/components/ChatInput.tsx` 已增加 `handlePaste`，从 `e.clipboardData.files` 读取粘贴文件，走与文件选择一致的 `prepareChatAttachments(files)` 压缩/回退逻辑后再加入附件列表。无文件的普通文本粘贴不拦截，仍走浏览器默认输入行为。

---

### #35 语音输入实时转录反馈
**优先级：低**

**问题：** Employee-agent 语音录制时用户看不到任何文字（录完才发请求），体验明显逊于 Hermes。

**Hermes 做法** — `src/renderer/src/screens/Chat/hooks/useVoiceInput.ts`
```ts
// 主路径：浏览器 SpeechRecognition（免费、实时）
if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
  const SR = (window.SpeechRecognition || window.webkitSpeechRecognition)!;
  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    const text = Array.from(e.results).map(r => r[0].transcript).join("");
    onResultRef.current(text, !e.results[e.results.length - 1].isFinal);
  };
  recognition.start();
  return () => recognition.stop();
}

// 降级路径：MediaRecorder + Whisper，每 2.5s 发一次 interim 请求
const LIVE_INTERVAL_MS = 2500;
const inFlightRef = useRef(false);  // 防并发
const finalizingRef = useRef(false); // 防 final 被 interim 覆盖

const sendInterim = async () => {
  if (inFlightRef.current || finalizingRef.current) return;
  inFlightRef.current = true;
  try {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const text = await transcribe(blob);
    if (!finalizingRef.current) onResultRef.current(text, true); // isInterim=true
  } finally {
    inFlightRef.current = false;
  }
};
liveIntervalRef.current = setInterval(sendInterim, LIVE_INTERVAL_MS);
```
用 `onResultRef = useRef(onResult)` + `onResultRef.current = onResult` 防止 callback 闭包过期。

**Employee-agent 现状** — `client/src/components/ChatInput.tsx`
- 无 SpeechRecognition 路径
- 只有 MediaRecorder + `recorder.onstop` 里的一次性 Whisper 请求
- 录音中展示"正在录音…"纯静态文字，没有实时字幕

**需要修改的文件：**
- `client/src/components/ChatInput.tsx` 或抽出 `client/src/hooks/useVoiceInput.ts`
  1. 先尝试 `window.SpeechRecognition`；若可用，interim result 写入 textarea
  2. 降级时每 2.5s 向 `/api/claw/voice/transcribe` 发当前 chunk，拿到 text 更新 textarea
  3. 用 `inFlightRef` + `finalizingRef` 防并发和 final 被覆盖
  4. `onResultRef` 保持 callback 稳定

**实施建议：** 语音是辅助功能，现有路径不影响主流程稳定性。可单独排一个迭代做，也可跳过。

---

### #36 Markdown `<img>` 协议 + 格式安全验证
**优先级：中 | 成本：极低（30 行）**

**问题：** `ChatMarkdown.tsx` 的 `normalizeSafeHref` 只挂在 `components.a`，`components.img` 完全没有 override。AI 输出 `![alt](data:text/html,...)` 或非图片 URL（如 `report.pdf`）时直接 pass 给浏览器 `<img src=...>` 渲染：
- `data:` URL 在某些浏览器场景下可触发 XSS
- 非图片格式（PDF/CSV）渲染为破图

**Hermes 做法** — `src/renderer/src/components/AgentMarkdown.tsx`
```ts
function isImageSrc(src: string): boolean {
  try {
    const u = new URL(src, window.location.origin);
    if (!["http:", "https:", "data:"].includes(u.protocol)) return false;
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?|$)/i.test(u.pathname);
  } catch { return false; }
}

// 在 components.img 里：
img: ({ src, alt }) => {
  if (!src || !isImageSrc(src)) {
    // 降级：渲染为下载链接
    return <a href={normalizeSafeHref(src) ?? "#"} target="_blank">{alt || src}</a>;
  }
  return <img src={src} alt={alt} style={{ maxWidth: "100%" }} />;
}
```

**需要修改的文件：**
- `client/src/components/ChatMarkdown.tsx` — 补 `components.img` override：
  1. 协议白名单：只允许 `http:` / `https:`（`data:image/...` 可酌情允许）
  2. 扩展名检测：非图片格式降级为 `<a>` 下载链接
  3. 最大宽度限制：`max-width: 100%` 防止大图溢出

**Done 2026-06-06:** 已在 `client/src/components/ChatMarkdown.tsx` 增加 `components.img` override。当前策略比 Hermes 更保守：只允许 `http:` / `https:` 且 URL path 扩展名明确为 `png/jpg/jpeg/gif/webp/bmp/ico/avif`；不允许 `data:`、`javascript:`、`blob:` 和 `svg`。非法图片降级为不可点击文本，合法图片使用 lazy loading、`referrerPolicy="no-referrer"` 和 `.lingxia-md-image` 尺寸约束，避免撑破气泡。

---

### #37 Settings 保存反馈
**优先级：低 | 成本：极低（10 行）**

**问题：** `SettingsPanel.tsx` 的 `update()` 调用 `applySettings(patch)` 后无任何视觉确认，用户不知道设置是否已保存。

**Hermes 做法：** 设置变更后显示 "已保存" 文字，2s 后 fade out。

**需要修改：** `client/src/components/settings/SettingsPanel.tsx` — 在 `update()` 后设置 `setSavedVisible(true)`，`setTimeout(() => setSavedVisible(false), 2000)`，右上角显示一个淡出的 "✓ 已保存" chip。

**Deferred 2026-06-06:** 当前设置保存链路已有 `toast.success("员工智能体设置已保存")`，用户可获得保存成功反馈。Hermes 的 "Saved" chip 更偏轻量美化，不影响稳定性与正确性，建议等设置页整体重构时一起做。

---

### #38 对话内容导出
**优先级：低 | 成本：小（2h）**

**问题：** 无法将对话导出为文本/Markdown，企业用户偶有留存记录或归档的需求。

**Hermes 做法** — `src/renderer/src/screens/Chat/transcriptUtils.ts`
```ts
export function buildChatTranscript(messages, format: "text" | "markdown" = "text"): string {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => format === "markdown"
      ? `**${m.role === "user" ? "用户" : "AI"}**\n\n${m.content}`
      : `[${m.role === "user" ? "用户" : "AI"}]\n${m.content}`)
    .join("\n\n---\n\n");
}
```

**需要修改：**
- 前端：消息列表上方或右键菜单增加 "导出对话" 按钮
- 触发 `buildChatTranscript(messages, "markdown")` → `Blob` → `URL.createObjectURL` → download link
- 纯前端实现，无需后端接口

**Done 2026-06-06:** 已由 `client/src/components/ChatInput.tsx` 覆盖：工具栏存在”导出 Markdown”按钮，基于当前 `messages` 生成 Markdown Blob 并下载 `conversation-YYYY-MM-DD.md`，无需新增后端接口。

---

### #39 `activeToolElapsed` 提取为子组件
**优先级：中 | 成本：极低（30 分钟）**

**问题：** `Home.tsx:1717-1722` 用 `setInterval(tick, 1000)` 驱动 `activeToolElapsed` state（`useState` in `Home.tsx`），工具执行期间每秒触发一次 `Home.tsx` 全树重渲染。一次 60 秒工具调用 = 60 次不必要的全树 diff，43 个 state 的所有消费子树都要过一遍。

**Hermes 做法：** 计时器状态放在 `ToolCallRow` 等子组件的局部 `useState` 里，tick 只 re-render 那一个小组件。

**修法：**
```tsx
// 新建文件或直接内联在 ChatMessage.tsx 里：
function ElapsedTimer({ startMs }: { startMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startMs) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [startMs]);
  return <>{elapsed}s</>;
}
```

**需要修改的文件：**
- `client/src/pages/Home.tsx` — 删除 `activeToolElapsed` / `activeToolStartMs` state 及其 setInterval effect；把 `activeToolStartMs` 值通过 prop 向下传递
- `client/src/components/ChatMessage.tsx` 或 `ToolCallCard` — 在工具进度显示处替换为 `<ElapsedTimer startMs={tc.ts} />`

**注意：** `activeToolStartMs` 仍需作为信号量在 `Home.tsx` 保留（判断当前哪个工具在执行），但不需要每秒 setState — 将其改为 `useRef` 或保留 state 但去掉 tick interval，由子组件自行计时。

**Done 2026-06-06:** 复核后发现当前 composer 已不展示 `activeToolElapsed`，只展示“工具 N 个运行中”；因此最小修复不是新增 `<ElapsedTimer>`，而是直接删除 `activeToolElapsed` state、每秒 `setInterval` effect，以及旧 SSE 事件中对 `setActiveToolElapsed` 的残留写入。`activeToolStartMs` 保留，用于工具超时文案计算和未来需要时的起始时间信号。这样工具运行期间不再每秒触发 `Home.tsx` 全树重渲染。

---

### #40 `startTransition` 包裹流式 `setMessages`
**优先级：中 | 成本：极低（1 行）**

**问题：** `useLingxiaChat.ts:159` 的 `setMessages` 是高优先级同步更新。快速流式响应（30-50 tokens/秒）时，每个 chunk 的 re-render 会抢占用户操作（滚动、输入、点击），导致滚动卡顿和按钮点击延迟。

**React 18 修法：**
```ts
// client/src/hooks/useLingxiaChat.ts
import { startTransition } from “react”;

// dispatchEvent 内：
startTransition(() => {
  setMessages((prev) => reduceLingxiaChatState(prev, event, {
    targetMessageId,
    adoptId: adoptId ?? undefined,
    nowMs: now(),
  }));
});
```

**效果：** React 将流式更新标记为可打断的低优先级任务。用户点击/输入时，React 优先响应用户操作，再继续渲染 streaming 文字。流式文字渲染最多延迟 1-2 帧（~16-33ms），对阅读体验无感知影响。

**Hermes 对比：** Hermes 用 Electron IPC 接收 streaming 消息，消息经过 Node.js 事件循环再发到 renderer，天然有类似 `startTransition` 的调度效果。Web SSE 无此缓冲，需要显式标记。

**注意：** `setIsStreaming(false)` 等终止信号**不要**包在 `startTransition` 里——终止是高优先级操作，需立即生效。只包文本 delta 的 `setMessages`。

**Done 2026-06-06:** `client/src/hooks/useLingxiaChat.ts` 已引入 React `startTransition`。`dispatchEvent` 中非终止类 chat event 的 `setMessages(reduceLingxiaChatState)` 使用 `startTransition` 降优先级；`transport.error`、`transport.done`、`transport.recovered`、`transport.recovery_failed` 等终止/恢复信号仍保持同步高优先级，确保 `isStreaming=false`、错误态和恢复态立即生效。

---

### #41 老 SSE 路径超时后 `lingxiaStreaming` 未自动清除
**优先级：低 | 仅在 `chatV2Enabled = false` 时生效**

**问题：** `Home.tsx:1727-1732` 的 `connStatus` 轮询在流静默 90s 后只设 `connStatus: “reconnecting”`，**不会** abort 流或清除 `lingxiaStreaming`。用户会看到重连提示，但 streaming 状态永远不会自动退出。

chatV2 路径（`useLingxiaChat` hook）已通过 watchdog (#30) 正确处理：超时 → `dispatch transport.error:stream_timeout` → `setIsStreaming(false)`。

**修法（仅需在老 SSE path 的轮询里补一行）：**
```ts
// Home.tsx:1729 条件内：
if (Date.now() - lastEventAtRef.current > 90_000) {
  setConnStatus(“reconnecting”);
  // 新增：
  lingxiaStreamAbortRef.current?.abort();
  setLingxiaStreaming(false);
}
```

**前提确认：** 若老 SSE 路径（`chatV2Enabled=false`）已在所有部署中停用，可将此项标记为 N/A 关闭。

**Done 2026-06-06:** 老 SSE 断连检测已补兜底：90 秒无事件时递增 `streamSeqRef`、abort 当前 `lingxiaStreamAbortRef`、清空 active tool 状态，并 `setLingxiaStreaming(false)`。现代 chatV2 路径仍由 `useLingxiaChat` watchdog 负责；该修复只覆盖旧 SSE fallback，低风险。

---

### #42 文件拖拽上传
**优先级：高 | 成本：小（2~3h）**

**问题：** Employee-agent 完全没有拖拽文件上传支持（无 `onDragEnter`/`onDragOver`/`onDrop` 处理器）。用户只能点击上传按钮或粘贴，无法直接把文件从桌面/文件管理器拖入聊天框。

**Hermes 做法** — `src/renderer/src/screens/Chat/Chat.tsx:63, 299-353`

```ts
const dragCounter = useRef(0); // dragCounter 防止子元素进出触发闪烁（#13 已分析）

const handleDragEnter = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  dragCounter.current += 1;
  if (dragCounter.current === 1) setDragActive(true);
}, []);

const handleDragLeave = useCallback(() => {
  dragCounter.current = Math.max(0, dragCounter.current - 1);
  if (dragCounter.current === 0) setDragActive(false);
}, []);

const handleDrop = useCallback(async (e: React.DragEvent) => {
  e.preventDefault();
  dragCounter.current = 0;
  setDragActive(false);
  const files = Array.from(e.dataTransfer.files);
  await ingestFiles(files); // 与点击上传走同一套 compress 逻辑
}, []);

// JSX：聊天容器包裹层
<div onDragEnter={handleDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={handleDragLeave} onDrop={handleDrop}>
  {/* 遮罩层 */}
  {dragActive && (
    <div className="chat-drop-overlay" aria-hidden>
      <div className="chat-drop-overlay-inner">拖放文件到此处上传</div>
    </div>
  )}
  ...
</div>
```

CSS（`main.css:2997`）：
```css
.chat-drop-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.chat-drop-overlay-inner {
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  padding: 24px 36px;
  color: #fff; font-size: 16px; font-weight: 600;
}
```

**需要修改的文件：**
- `client/src/pages/Home.tsx` 或 `client/src/components/ChatInput.tsx` — 在聊天容器外层加四个 drag 事件处理器 + `dragCounter` ref + `dragActive` state
- `client/src/index.css` — 加 `.lingxia-drop-overlay` + `.lingxia-drop-overlay-inner` 样式

**注意：** 文件拖入后直接调用 `prepareChatAttachments(files)` 走压缩逻辑，与点击上传、粘贴路径完全一致。

---

### #43 图片附件发送前缩略图预览
**优先级：中 | 成本：小（1h）**

**问题：** `ChatInput.tsx:523` 的附件列表只渲染文件名文字 chip（`lingxia-attachment-chip`），图片类型没有缩略图。用户无法确认图片内容就发送了，体验差。

**Hermes 做法：** 附件区域对图片文件渲染 `<img src={URL.createObjectURL(file)} />` 缩略图，64×64px，加载后释放 object URL。

**修法：**
```tsx
// ChatInput.tsx 附件 map 里：
{attachments.map((file, i) => {
  const isImage = file.type.startsWith("image/");
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div key={i} className="lingxia-attachment-chip">
      {isImage && thumbUrl
        ? <img src={thumbUrl} alt={file.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
        : <span className="max-w-[120px] truncate">{file.name}</span>
      }
      <button onClick={() => removeAttachment(i)}>×</button>
    </div>
  );
})}
```

**注意：** 不能在 `map` 里直接 `useState`（Hook 规则）——应把单个附件提取为 `AttachmentChip` 子组件。

---

### #44 消息内图片点击放大（Lightbox）
**优先级：中 | 成本：小（1h）**

**问题：** AI 回复内容或用户发送的图片，点击后没有任何反应。Hermes 有全屏 lightbox 遮罩，用户可放大查看图片细节。

**Hermes 做法** — `src/renderer/src/screens/Chat/MessageRow.tsx:155-195`
```tsx
const [previewSrc, setPreviewSrc] = useState<string | null>(null);

// 在 img 上加 onClick：
<img src={src} onClick={() => setPreviewSrc(src)} style={{ cursor: "zoom-in" }} />

// Lightbox 遮罩：
{previewSrc && (
  <div className="chat-image-preview-backdrop" onClick={() => setPreviewSrc(null)} role="dialog" aria-modal="true">
    <img src={previewSrc} className="chat-image-preview-image" onClick={(e) => e.stopPropagation()} />
  </div>
)}
```

CSS：
```css
.chat-image-preview-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; cursor: zoom-out;
}
.chat-image-preview-image {
  max-width: 90vw; max-height: 90vh;
  border-radius: 8px; object-fit: contain;
}
```

**需要修改的文件：**
- `client/src/components/ChatMarkdown.tsx` — 在 `components.img` override 里（#36 已有）加 `onClick → setPreviewSrc`，用 portal 渲染遮罩层；或在 `ChatMessage.tsx` 层面用 state 管理 preview src。

---

### #45 空对话建议词 chips
**优先级：低 | 成本：极低（30min）**

**问题：** 空对话状态只有欢迎文字（`Home.tsx:3110`），没有可点击的建议词。Hermes 的 `ChatEmptyState` 有 6 个建议按钮，点击直接填充输入框，降低用户冷启动摩擦。

**Hermes 做法** — `src/renderer/src/screens/Chat/ChatEmptyState.tsx`
```tsx
const SUGGESTIONS = [
  { Icon: Search, text: "帮我搜索..." },
  { Icon: Calendar, text: "设置一个提醒..." },
  { Icon: Mail, text: "帮我写一封邮件..." },
  { Icon: Code, text: "写一个脚本..." },
  { Icon: Clock, text: "整理我的日程..." },
  { Icon: BarChart, text: "分析这份数据..." },
];

<div className="chat-empty-suggestions">
  {SUGGESTIONS.map(({ Icon, text }) => (
    <button key={text} className="chat-suggestion" onClick={() => onSelectSuggestion(text)}>
      <Icon size={14} />{text}
    </button>
  ))}
</div>
```

**需要修改的文件：**
- `client/src/pages/Home.tsx:3110` — 在欢迎气泡下方加 2-4 个建议 chips，`onClick` 调用 `setLingxiaInput(text)` 并 focus textarea

---

## 讨论区

> 在此追加讨论，格式：`**[作者] [日期]:** 内容`

**[Claude] 2026-06-06:** 文档初始化完成。#1/#2/#3 建议作为第一批实施，改动最小但收益最高。#7（消息入场动画）和 #9（useChatScroll）可以一起做，都在前端 UI 层，互不依赖。

**[Claude] 2026-06-06（第二轮全面 review）：** 新增 #15-#29，补充了上轮未覆盖的内容。以下是新增项的实施优先级建议：

**高优（直接影响稳定性/正确性）**
- **#15** `handleNewChat` 先 abort — 极低成本，防止幽灵消息，建议和 #1 同批
- **#25** 图片自动压缩 — 有用户可感知 bug（大图报 JSON 错误），应尽快修
- **#17** Tab 懒挂载保活 — 影响整体响应速度，尤其是频繁切 tab 的场景

**中优（体验提升）**
- **#20** Markdown 链接安全验证 — 安全问题，低成本
- **#18** Slash 命令面板 — 大幅提升 power user 效率，但工作量中等
- **#19** 代码块懒加载高亮 + 复制 — ChatMarkdown 核心体验
- **#22** Session 列表日期分组 + 防竞态 — SessionList 已有搜索，防竞态尤其重要
- **#27** 启动后台深度验证 — 如果当前启动有明显延迟再做
- **#28** cleanLeakedToolTags — 遇到模型泄漏时再修

**低优（锦上添花）**
- **#16** 原子写 — 服务器配置写入已有 drizzle 事务保护的可以跳过
- **#21** diff 渲染 — 代码 agent 场景才明显
- **#23/#24** Slash 面板交互细节 — 做 #18 时顺带
- **#26** 流结束重聚焦 — 一行代码，顺手加
- **#29** MediaSegment key — 只在有 media token 的场景才体现，目前优先级低

**[Codex] 2026-06-06:** 已落地 #1/#6。#2 暂缓，因为消息队列会改变忙碌期间发送语义，需要先定产品策略。#3 暂缓，因为当前 `useLingxiaChat.send` 未直接依赖 `messages`，需要先证明 streaming 重渲染热点。#7/#9 属于 UI 体验优化，可作为下一批，但不建议和刚稳定下来的 OpenClaw 流式链路同一批大改。

**[Codex] 2026-06-06（第二轮复核）:** 复核 #15-#29 后，已把实际状态校准并落地低风险项：
- #12 已由 `client/src/components/ChatInput.tsx` 实现，上下箭头可翻输入历史。
- #15 已由 `useLingxiaChat.clear()` 实现：先 `abort("clear")`，再清空 messages。
- #20 已在 `client/src/components/ChatMarkdown.tsx` 补协议白名单：仅允许 `http:` / `https:` / `mailto:` / 页内锚点，其他链接降级为不可点击文本。
- #24 已统一 textarea 高度计算到 `requestAnimationFrame`。
- #26 已由 `ChatInput` 的 streaming 状态边沿检测实现：流结束后下一帧自动 focus。

仍建议优先考虑但暂未实施：
- #17 Tab 懒挂载保活：需要先确认主布局是否存在 tab 切换重挂载导致的重连/慢加载，不能直接按 Hermes 的桌面布局套。
- #22 Session 搜索防竞态：和历史记录偶发 403/搜索结果一致性相关，适合下一批做。
- #19 当前已有代码块复制按钮，但仍同步加载 `rehype-highlight`；如后续首屏 bundle 变重，再做懒加载。

**[Codex] 2026-06-06（图片附件压缩）:** 已落地 #25：新增 `client/src/lib/image-compress.ts`，ChatInput 文件选择时会对超过目标大小的 JPEG/PNG/WebP 等可解码图片做客户端压缩；PDF/Excel/Word/文本不处理，GIF/SVG 不处理，压缩失败自动回退原文件。目标是降低大图上传耗时和 JSON body/网关压力，同时不改变普通文件上传语义。

**[Claude] 2026-06-06（第二轮复核验证）：** 逐一确认 Codex 第二轮落地的 5 项：
- **#12** ✅ `ChatInput.tsx` 输入历史实现正确：localStorage 持久化、30 条上限、dedup、草稿恢复、rAF focus 对齐。
- **#15** ✅ `useLingxiaChat.clear()` 已做到 abort-before-clear（line 386-393）。补充：`startNewLingxiaConversation` 采用"流中则 toast 拦截"策略而非"先 abort 再清空"，两者都安全，但前者要求用户手动停止后才能开新对话，与 Hermes 强制中断有语义差异，产品上可接受。
- **#20** ✅ `normalizeSafeHref()` 白名单 (http/https/mailto/锚点)，unsafe 协议降级 `<span>` 不可点击。
- **#24** ✅ `resizeTextareaNextFrame` 在 onChange、历史导航、resize effect 三处统一使用，无遗漏路径。
- **#26** ✅ 边沿检测 + 额外 `requestAnimationFrame` 包裹，比 Hermes 参考更稳。

**下一批建议（收益/成本排序）：**
1. **#7** 消息入场动画 — 纯 CSS，10 分钟，丝滑感收益最直接
2. **#10** 三点打字指示器 — CSS keyframe + 条件渲染，约 1 小时
3. **#22** Session 搜索防竞态 — `SessionList.tsx` 加 `searchRequestIdRef`，防历史搜索结果乱序
4. **#17** Tab 懒挂载 — 先确认布局层是否存在重挂载问题，再评估改动范围

**[Claude] 2026-06-06（第三轮复核验证）：**
- **#7** ✅ `.lingxia-msg-fade` + `@keyframes lingxiaFadeIn` — translateY(4px) 淡入 0.18s，与 Hermes 参考一致，user/AI 两端均已挂上该 class。
- **#10** ✅ `isPlaceholder` 气泡使用 `.lingxia-typing-dots` 三点跳动，延迟梯度 0/140ms/280ms；`ToolCallTimeline` 在 placeholder 上方叠加显示，两者并存视觉上略有重叠感但不是 bug，产品上可接受。
- **#22** ✅ N/A 评估正确：SessionList 用本地同步 filter + `messageSearchProvider`（缓存读取），无异步请求竞态，不需要 `searchRequestIdRef`。

当时快照：#1 #6 #7 #10 #12 #15 #20 #24 #25 #26 已完成；#2 #3 暂缓；#22 不适用。当前状态以文档顶部状态总览和第五轮复核为准。

**下一批建议：**
1. **#9** `useChatScroll` 统一滚动逻辑 — 消除分散在多处的滚动逻辑，中优
2. **#8** Avatar 分组 — 配合 #10 已完成的打字指示器，视觉一致性好
3. **#28** `cleanLeakedToolTags` — 模型偶发泄漏已被用户感知时优先修
4. **#17** Tab 懒挂载 — 需先用 React DevTools 或日志确认是否有重挂载

**[Codex] 2026-06-06（第三轮复核）:** 复核 Claude 下一批建议后，状态如下：
- #7 已完成：`ChatMessage`/欢迎消息已使用 `lingxia-msg-fade`，`client/src/index.css` 中定义了 `lingxiaFadeIn .18s ease-out`，效果与 Hermes 的轻量入场动画一致。
- #10 已完成：空 assistant placeholder 已从 Tailwind `animate-pulse` 改为 `lingxia-typing-dots` 上下跳动三点；工具进度继续由 `ToolCallTimeline`、工具卡片和 composer 状态 chip 显示，避免重复 UI。
- #22 当前不建议直接照搬：`SessionList` 现在做的是本地同步过滤、日期分组和高亮，`messageSearchProvider` 也是同步读取缓存，不存在 Hermes 异步搜索请求乱序竞态；如果后续改成服务端全文搜索，再引入 `searchRequestIdRef`。
- #17 仍需先做重挂载证据确认，避免为了保活把页面常驻内存扩大。

**[Codex] 2026-06-06（泄漏工具标签清理）:** 已落地 #28：新增 `client/src/lib/clean-leaked-tags.ts`，在 `ChatMessage` 渲染 assistant 正文前清理 snake_case/kebab-case 且内容为 JSON 的泄漏工具标签；普通 HTML/Markdown 标签和非 JSON 内容不改。该清理只影响前端展示与复制内容，不改 reducer、不改历史保存原文。已补 `client/src/lib/clean-leaked-tags.test.ts` 覆盖普通标签不误伤、JSON 工具标签摘要、自闭合工具标签等场景。

**[Codex] 2026-06-06（流式 watchdog）:** 已落地 #30：`useLingxiaChat` 增加流式空闲 watchdog。发送后首事件兜底 180 秒，避免误杀 OpenClaw 慢首 token；收到真实进展事件（delta/thinking/tool/status/workspace/agent 事件）后切换为 90 秒空闲超时。超时会 abort 当前 controller、关闭 active transport，并向当前 assistant 消息派发 `transport.error: stream_timeout`，避免 TCP 静默断连后 `isStreaming` 永久卡 true。`transport.truncated` / `transport.in_flight` 不续 watchdog，避免恢复轮询期间误触发。

**[Codex] 2026-06-06（滚动与稳定 key）:** 已落地 #31，并部分落地 #9：主聊天消息列表从 `key={idx}` 改为 `key={m.id || role-index}`，让 chatV2/backfilled message id 能稳定复用 `ChatMessage` memo。滚动监听从 React `onScroll` 直接 `setState` 改为原生 passive listener + `lingxiaNearBottomRef` + 状态变更去重；streaming 自动滚动时只读 ref，避免每次滚动都推动 Home 重渲染。最后一条消息是 user 时会强制恢复 near-bottom 并滚到底，修复“用户滚上去后发新消息看不到自己刚发内容”的体验问题。尚未抽成独立 `useChatScroll` hook，因此 #9 标为 PARTIAL。

**[Codex] 2026-06-06（流结束 DB 对账）:** 已落地 #4：旧 SSE 路径继续复用既有 `reconcileStreamedConversation`；chatV2 路径在发送时登记本轮 `conversationId + streamSeq`，流结束后捕获最后一条 assistant id 并主动拉取 OpenClaw 历史做 canonical merge。合并策略保持保守：只更新当前最后一条 assistant 的更完整正文和工具调用，不替换整段会话，避免 DOM 大范围重挂。后端历史 dedupe 同时允许”正文为空但有 toolCalls”的 assistant 消息保留，避免工具结果只落历史但前端对账时拿不到。

**[Claude] 2026-06-06（第四轮全面对比）：** 对比 Hermes 与 employee-agent 代码后，新增 #32/#33/#34，补充 #17 确认证据：

新增项：
- **#32** IME guard — `ChatInput.tsx` Enter 处理缺少 `e.nativeEvent.isComposing` 检查，中文/日文用户 Enter 选词时必现误发。**1 行修复，高优。**
- **#33** parseMediaTokens useMemo — `ChatMessage.tsx:554` 的 `cleanLeakedToolTags(text)` 直接在 render 里执行无缓存，streaming 期间每个 chunk 重跑完整 regex 管道，随消息增长 O(n²)。改为 `useMemo(..., [text])` 即可。**高优。**
- **#34** 图片粘贴未压缩 — `prepareChatAttachments` 只在 `handleFileSelect` 调用，paste 路径（Ctrl+V 粘贴截图）不经压缩直接入附件列表。补 `onPaste` handler 即可与 file-select 对齐。**中优。**

#17 已确认：`MainPanel.tsx` 用纯条件赋值 content，每次切 tab 完全重挂载，无需 DevTools 再验证，可直接实施 `visitedPages` 保活。

当时快照：#1 #4 #6 #7 #10 #12 #15 #20 #24 #25 #26 #28 #30 #31 已完成；#9 部分完成；#2 #3 暂缓；#22 不适用。当前状态以文档顶部状态总览和第五轮复核为准。

**建议 Codex 下一批（按 ROI）：**
1. **#32** IME guard — 1 行，立即修
2. **#33** parseMediaTokens useMemo — 30 分钟，streaming 性能
3. **#17** Tab 懒挂载 — 半天，`MainPanel.tsx` 改 visitedPages，切 tab 不再重挂载
4. **#34** 图片粘贴压缩 — 1 小时，补 onPaste handler

**[Codex] 2026-06-06（IME / 渲染缓存 / 粘贴压缩）:** 已落地 #32/#33/#34：
- #32：`ChatInput` 在 `onKeyDown` 入口加入 IME composing guard，覆盖 Enter 发送和 @mention 快捷键选择，避免中文/日文输入法选词误发。
- #33：`ChatMessage` 用 `useMemo` 缓存 `cleanLeakedToolTags(text)` 的结果，减少 streaming 外的重复清理和复制/工具状态变化带来的额外渲染成本。
- #34：`ChatInput` 增加 `onPaste` 附件路径，粘贴截图/图片也走 `prepareChatAttachments`，与文件选择器压缩逻辑保持一致。

当时快照更新：#1 #4 #6 #7 #10 #12 #15 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34 已完成；#9 部分完成；#2 #3 暂缓；#22 不适用。当前状态以文档顶部状态总览和第五轮复核为准。

**[Codex] 2026-06-06（第五轮剩余项复核）:** 已重新梳理剩余 TODO，并在状态总览下新增“剩余项优先级”：
- **唯一 P0 / TODO：#17 Tab 懒挂载 + visitedViews 保活**。`MainPanel.tsx` 已确认是纯条件渲染，切 tab 会 unmount/remount，建议下一批单独做。（随后已完成，见第六轮记录。）
- **DEFER：#2 #5 #8 #14 #16 #18 #19 #35**。这些有一定价值，但目前不是主链路稳定性瓶颈，需等产品策略或性能证据。
- **N/A / 暂不做：#3 #11 #13 #21 #22 #23 #27 #29**。这些要么原假设不成立，要么当前产品形态下收益低、容易增加复杂度。
- **#9 已从 PARTIAL 调整为 DONE**：虽然没有抽成独立 `useChatScroll` hook，但稳定 key、passive scroll、near-bottom ref、用户发消息强制滚底这些实际行为已完成；继续抽 hook 属于代码整理，不再作为独立待办。

当时准确信息：DONE 18 项（#1 #4 #6 #7 #9 #10 #12 #15 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34），TODO 1 项（#17），DEFER 8 项，N/A 8 项。当前状态以第六轮记录为准。

**[Codex] 2026-06-06（第六轮 #17 完成）:** 已落地 #17：`MainPanel` 从单一 `content` 条件渲染改为页面注册表 + `visitedPages`。非聊天 tab 首次访问才挂载，之后保活隐藏；页面错误边界按 tab 独立；`adoptId` 变化时重置保活集合并通过 key remount，避免不同员工智能体之间串状态。

当前准确信息：DONE 19 项（#1 #4 #6 #7 #9 #10 #12 #15 #17 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34），TODO 0 项，DEFER 8 项，N/A 8 项。

**[Claude] 2026-06-06（第五轮核实 #32/#33/#34 + 深度对比）：** 三项代码核实全部通过：
- **#32** ✅ `ChatInput.tsx:232` `if (e.nativeEvent.isComposing || e.keyCode === 229) return;` — 正确覆盖 keyCode 229 fallback（Android/旧 Chrome 不设置 isComposing 时的降级路径）
- **#33** ✅ `ChatMessage.tsx:554` `const displayText = useMemo(() => cleanLeakedToolTags(text), [text])` — deps 绑定正确，streaming chunk 来时 memo 命中，无 O(n²) 回归
- **#34** ✅ `handlePaste` 读 `e.clipboardData?.files`，有 `submittingAttachments` 锁防并发，走与 file-select 相同的 `prepareChatAttachments` 路径

深度对比 Hermes 剩余所有文件（useVoiceInput、HistoryRow、ChatEmptyState 等）新发现已记入 **#35**（已 DEFER）。其他差距（折叠工具调用/主题/键盘快捷键/suggestion chips）均为设计差异或低价值，不需要新增条目。

当时建议：#17（Tab 懒挂载）为唯一 TODO，实施路径为 `MainPanel.tsx` 改 `visitedPages` Set + `display:none` 保活。该项现已完成，当前状态以第六轮记录为准。

**[Claude] 2026-06-06（第六轮全面扫描，#36/#37/#38）：** 对 Hermes 全部剩余目录做了系统扫描（Settings/、components/、main/、hooks/、ChatInput、transcriptUtils 等）。共找到 35 条候选，逐一排查后：

- **已覆盖，agent 重复报告（~25 条）：** 流式 reasoning → 已有 `applyReasoningDelta` + 虚拟 thinking toolCall + GATEWAY_TOOL_META；IME guard → #32 DONE；rAF → #24 DONE；image compression → #25 DONE 含透明度检测；cleanLeakedToolTags → #28 DONE；voice → #35 DEFER；session cache → #14 DEFER；link safety → #20 DONE；stable key → #31 DONE 等。
- **Desktop-only，不适用（~7 条）：** PID liveness、profile DB path、SSH tunnel、native dialogs、local file media verification。
- **真正遗漏的 3 条：**
  - **#36** `<img>` 安全验证：`components.img` 无 override，`data:` URL 和非图片格式未过滤。修法：30 行 override，协议白名单 + 扩展名检测。**中优，建议下一批做**。
  - **#37** Settings 保存反馈："已保存" 2s fade，纯 UI 提示。低优，10 行。
  - **#38** 对话导出：纯前端 Blob download，企业归档需求。低优，2h。

当前准确信息：DONE 19 项，TODO 3 项（#36 #37 #38），DEFER 8 项，N/A 8 项。

**[Codex] 2026-06-06（第七轮 #36/#37/#38 复核）:** 已复核 Claude 第六轮新增 3 条：
- **#36 DONE**：`ChatMarkdown` 已补 markdown 图片安全渲染。策略比 Hermes 更保守，只允许 `http/https` + 明确图片扩展名，拒绝 `data:`/`svg`/非图片 URL，合法图片 lazy load 且限制尺寸。
- **#37 DEFER**：设置保存已有 toast 成功反馈；Hermes 式 "Saved" chip 是轻量美化，暂不进入稳定性主线。
- **#38 DONE**：`ChatInput` 工具栏已有“导出 Markdown”按钮，纯前端 Blob 下载当前对话，不需要新后端接口。

当前准确信息：DONE 21 项（#1 #4 #6 #7 #9 #10 #12 #15 #17 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34 #36 #38），TODO 0 项，DEFER 9 项（#2 #5 #8 #14 #16 #18 #19 #35 #37），N/A 8 项。

**[Claude] 2026-06-06（第七轮性能/稳定性深度分析，新增 #39/#40/#41）：**

对 `Home.tsx`、`useLingxiaChat.ts`、`openclaw-ws.ts` 进行了针对性代码审查，聚焦流式渲染性能和稳定性热点：

**稳定性结论：** 关键路径（chatV2 / `useLingxiaChat`）整体扎实。isMountedRef、watchdog、abort-first、IME guard、passive scroll 等均已覆盖。仅发现一处遗漏：**老 SSE 路径（#41）** 超时后只更新 UI 状态不 abort 流，但现代部署默认走 chatV2，影响有限。

**性能热点（真实代码证据）：**
- **#39** `Home.tsx:1717-1722`：`setInterval(tick, 1000)` 每秒调用 `setActiveToolElapsed(state)`，触发 `Home.tsx` 43 个 state 的全树重渲染。工具执行 60 秒 = 60 次无意义全树 diff。Fix：提取为 `<ElapsedTimer startMs={...} />` 子组件局部 state，re-render 范围从 Home.tsx 全树缩到单个 span。
- **#40** `useLingxiaChat.ts:159`：`setMessages` 是高优先级同步更新，快速 streaming 期间（30-50 tokens/秒）与用户滚动/输入/点击竞争主线程。React 18 `startTransition` 一行可让 streaming 更新降优先级，用户操作优先响应。Hermes 靠 Electron IPC 事件循环天然获得等效效果。

**建议 Codex 下一批（按 ROI 排序）：**
1. **#40** `startTransition` — 1 行，`useLingxiaChat.ts:159`，`setMessages` 外套 `startTransition()`，`setIsStreaming(false)` 不套
2. **#39** `ElapsedTimer` 子组件 — 30 分钟，删 `activeToolElapsed`/`activeToolStartMs` state 的 setInterval effect，新建 `ElapsedTimer` 组件
3. **#41** 老 SSE 路径补 abort — 先确认 `chatV2Enabled` 是否为所有部署默认值；若是则关闭，若否则补 2 行

**[Codex] 2026-06-06（第八轮 #39/#40/#41 落地）:** 已复核并完成 Claude 第七轮新增 3 条：
- **#39 DONE**：当前 UI 已不展示 elapsed 秒数，因此没有新增子组件，而是直接删除 `activeToolElapsed` state、每秒 interval 和残留 setter。保留 `activeToolStartMs` 供超时文案使用。工具运行期间不再每秒触发 `Home.tsx` 全树重渲染。
- **#40 DONE**：`useLingxiaChat.dispatchEvent` 中非终止类消息 reducer 更新用 `startTransition` 降优先级；终止、错误、恢复事件仍同步处理，避免影响停止/错误态响应。
- **#41 DONE**：老 SSE fallback 90 秒无事件时现在会 abort 当前 stream、递增 stream seq、防旧 reader 继续写入，并退出 `lingxiaStreaming`。

当前准确信息：DONE 24 项（#1 #4 #6 #7 #9 #10 #12 #15 #17 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34 #36 #38 #39 #40 #41），TODO 0 项，DEFER 9 项（#2 #5 #8 #14 #16 #18 #19 #35 #37），N/A 8 项。

**[Claude] 2026-06-06（第八轮 UI 一致性深度对比，新增 #42–#45）：**

对比 Hermes 与 employee-agent UI 层全部代码后，过滤掉方向错误的项（employee-agent 已有或更好的：session 置顶/重命名/批量删除、toast 系统、消息复制按钮、token usage 展示、TTS、@mention、骨架屏、删除确认弹窗——均为 employee-agent 领先），找出 Hermes 有、employee-agent 缺失的 4 条真实 UI 差距：

- **#42 文件拖拽上传（高优）** — employee-agent 无任何 drag 事件处理器，用户无法把文件拖进聊天框。Hermes `Chat.tsx` 有 `dragCounter` + blur 遮罩完整实现。2~3h 工作量，接受所有文件类型，走与点击/粘贴相同的 `prepareChatAttachments` 路径。
- **#43 图片附件缩略图（中优）** — 发送前附件区只显示文件名 chip，图片看不到内容。Hermes 显示 64px 缩略图；需提取 `AttachmentChip` 子组件持有 object URL state。
- **#44 消息内图片 lightbox（中优）** — AI 回复或用户消息里的图片点击无反应。Hermes 有 `chat-image-preview-backdrop` 全屏预览；可复用 #36 已加的 `components.img` override，扩展加 onClick + portal。
- **#45 空对话建议词 chips（低优）** — 空聊天只有一句欢迎文字，Hermes 有 6 个可点击建议按钮。30 分钟工作量，`setLingxiaInput(text)` 即可。

**建议 Codex 下一批（按 ROI）：**
1. **#42** 拖拽上传 — 高频操作缺口，实现清晰，优先
2. **#43** 缩略图 — 中等，需提取子组件，约 1h
3. **#44** Lightbox — 中等，复用 #36 img override，约 1h
4. **#45** 建议词 — 低，30min，可顺带做

**[Codex] 2026-06-06（第九轮 #42/#43 落地）:** 已完成第八轮 UI 建议中的高频输入项：
- **#42 DONE**：`ChatInput` 增加文件拖拽上传，使用 `dragCounterRef` 防止拖入子元素时遮罩闪烁；drop 后复用现有 `prepareChatAttachments` 路径，因此拖拽、点击上传、粘贴截图三条路径都会走同一套图片压缩逻辑。
- **#43 DONE**：附件区提取 `AttachmentChip` 子组件，图片附件发送前显示缩略图，非图片显示紧凑文件标识；缩略图使用 `URL.createObjectURL`，组件卸载时自动 `revokeObjectURL`。
- **#44 DEFER / 暂时不做**：消息内图片 lightbox 先延后，避免把消息渲染安全策略、移动端预览交互和附件输入体验混在一批改。
- **#45 DEFER / 暂时不做**：空对话建议词暂不做通用 chips，后续如要做，建议跟岗位/场景绑定。

当前准确信息：DONE 26 项（#1 #4 #6 #7 #9 #10 #12 #15 #17 #20 #24 #25 #26 #28 #30 #31 #32 #33 #34 #36 #38 #39 #40 #41 #42 #43），TODO 0 项，DEFER 11 项（#2 #5 #8 #14 #16 #18 #19 #35 #37 #44 #45），N/A 8 项。

---

## Review Notes

_外部 review，2026-06-06_

### 整体评价

文档结构扎实，状态追踪粒度非常细，每一条都有源文件定位、Hermes 参考代码、实施路径和 Done/Defer 注记，方便后续接手的人直接上手。26 项 DONE 在一天内完成说明执行节奏很快。

### 几点建议

**1. DEFER 项缺少 owner 和触发条件**

`#2 消息队列` 和 `#5 Pre-send 健康检查` 的 DEFER 理由都是"需要产品确认"，但没有写谁来确认、什么时候回来看。建议在每条 DEFER 后面补一行：

```
**Re-evaluate when:** <触发条件或责任人>
```

否则这些条目容易进死角，下次 review 时还是 DEFER，无限循环。

**2. #44 Lightbox 的关闭理由可以更主动**

当前写的是"等用户明确反馈'图片看不清'"，但用户一般不会主动说这个，他们只是不用图片。建议改成数据驱动的条件，比如：

> 等图片类消息占全部消息比例数据出来，或者收到 ≥3 条"图片太小看不清"反馈时重新评估。

**3. #45 建议词 chips 的 DEFER 理由很好，但可以给一个更明确的下一步**

"跟岗位/场景绑定"是对的方向，建议在这条后面加一句：

> 如果后续上线岗位模板（如销售助手、财务分析师），可以在模板里配置 3-4 条预置建议词，不做全局通用版本。

这样后续做模板功能时能直接想到。

**4. 讨论区记录很详细，但有些过于碎片化**

目前讨论区里同一天出现了 8-9 轮 Claude/Codex 的交替记录，内容密度高但浏览困难。建议按功能分组折叠，或者把已关闭的历史讨论轮次归档到文档末尾的 `## 历史讨论存档` 块里，只在讨论区保留最后一次有效结论。
