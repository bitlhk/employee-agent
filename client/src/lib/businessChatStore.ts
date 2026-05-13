/**
 * businessChatStore — module-level 持久化 store for TaskPanel agent chats.
 *
 * 设计原则：
 *   - state 与 React 组件生命周期解耦：组件 unmount 后 fetch 仍能继续写入
 *   - 每个 agentId 一份 slice，跨 agent 切换不串扰
 *   - sessionStorage 双重持久化：刷新页面也能恢复
 *   - 多个组件可同时订阅同一 agent 的 state（虽然实际只有一个 TaskPanel）
 *
 * 用法：
 *   const state = useAgentState(agent.id);  // 自动 subscribe + re-render
 *   sendBusinessMessage(agent.id, text, apiBase, onComplete);  // 模块级 fetch
 *   clearAgentState(agent.id);  // 重置某 agent 的 state
 */
import { useEffect, useReducer } from "react";

export type HermesToolCall = {
  id: string;
  name: string;
  preview?: string;
  status: "running" | "done" | "error";
  ts: number;
  durationMs?: number;
};

export type TaskMessage = {
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  toolCalls?: HermesToolCall[];
  status?: string;
};

export type AgentState = {
  msgs: TaskMessage[];
  sessionKey: string | null;
  streaming: boolean;
};

const stores = new Map<string, AgentState>();
const subscribers = new Map<string, Set<() => void>>();
// in-flight AbortControllers, keyed by agentId — used by stopBusinessMessage
const controllers = new Map<string, AbortController>();

const skStorageKey = (agentId: string) => `collab_sk_${agentId}`;
const msgsStorageKey = (agentId: string) => `collab_msgs_${agentId}`;

function loadFromStorage(agentId: string): AgentState {
  let msgs: TaskMessage[] = [];
  let sessionKey: string | null = null;
  try {
    const savedMsgs = sessionStorage.getItem(msgsStorageKey(agentId));
    if (savedMsgs) msgs = JSON.parse(savedMsgs);
    sessionKey = sessionStorage.getItem(skStorageKey(agentId));
  } catch {}
  return { msgs, sessionKey, streaming: false };
}

function persistToStorage(agentId: string, state: AgentState) {
  try {
    sessionStorage.setItem(msgsStorageKey(agentId), JSON.stringify(state.msgs));
    if (state.sessionKey) {
      sessionStorage.setItem(skStorageKey(agentId), state.sessionKey);
    }
  } catch {}
}

function notify(agentId: string) {
  subscribers.get(agentId)?.forEach((fn) => fn());
}

export function getAgentState(agentId: string): AgentState {
  if (!stores.has(agentId)) {
    stores.set(agentId, loadFromStorage(agentId));
  }
  return stores.get(agentId)!;
}

export function setAgentState(
  agentId: string,
  updater: AgentState | ((s: AgentState) => AgentState),
): void {
  const cur = getAgentState(agentId);
  const next = typeof updater === "function" ? (updater as (s: AgentState) => AgentState)(cur) : updater;
  stores.set(agentId, next);
  persistToStorage(agentId, next);
  notify(agentId);
}

export function clearAgentState(agentId: string): void {
  stores.set(agentId, { msgs: [], sessionKey: null, streaming: false });
  try {
    sessionStorage.removeItem(msgsStorageKey(agentId));
    sessionStorage.removeItem(skStorageKey(agentId));
  } catch {}
  notify(agentId);
}

/** React hook: subscribe to a specific agent's state slice */
export function useAgentState(agentId: string): AgentState {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!subscribers.has(agentId)) subscribers.set(agentId, new Set());
    const set = subscribers.get(agentId)!;
    set.add(force);
    return () => {
      set.delete(force);
    };
  }, [agentId]);
  return getAgentState(agentId);
}

/**
 * sendBusinessMessage — 完全脱离 React 组件生命周期的 SSE fetch 函数。
 *
 * 即使调用方组件 unmount，这个 async fn 仍会继续写入 module-level store，
 * 用户切回 TaskPanel 时通过 useAgentState 看到完整结果。
 */
export async function sendBusinessMessage(
  agentId: string,
  text: string,
  apiBase: string,
  onComplete?: () => void,
): Promise<void> {
  // 1. 添加 user message + 占位 assistant message
  setAgentState(agentId, (s) => ({
    ...s,
    streaming: true,
    msgs: [
      ...s.msgs,
      { role: "user", text },
      { role: "assistant", text: "" },
    ],
  }));

  const initialState = getAgentState(agentId);
  const sessionKeyToSend = initialState.sessionKey;

  // Abort any existing stream for this agent before starting a new one
  controllers.get(agentId)?.abort();
  const controller = new AbortController();
  controllers.set(agentId, controller);

  // 2026-04-18: flushTimer / flushDelta 从 try 内提到 function 顶级作用域，
  // 让 L314 catch 块也能访问（TS flow narrow 不把 try 内 let 传到 catch）
  let pendingDelta = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let firstChunkFlushed = false;
  const flushDelta = () => {
    if (!pendingDelta) return;
    const d = pendingDelta;
    pendingDelta = "";
    setAgentState(agentId, (s) => {
      const n = [...s.msgs];
      const last = n[n.length - 1];
      n[n.length - 1] = {
        role: "assistant",
        text: (last?.text || "") + d,
        status: undefined,
        reasoning: last?.reasoning,
        toolCalls: last?.toolCalls,
      };
      return { ...s, msgs: n };
    });
  };
  const scheduleFlush = () => {
    if (!firstChunkFlushed) { firstChunkFlushed = true; flushDelta(); return; }
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushDelta(); }, 16);
  };

  try {
    const resp = await fetch(`${apiBase}/api/claw/business-chat-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({ agentId, message: text, sessionKey: sessionKeyToSend }),
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`请求失败 (${resp.status})`);
    }

    const sk = resp.headers.get("X-Session-Key");
    if (sk && !sessionKeyToSend) {
      setAgentState(agentId, (s) => ({ ...s, sessionKey: sk }));
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (line.startsWith(": ")) continue; // SSE comment / keepalive
        if (!line.startsWith("data: ")) {
          currentEvent = "";
          continue;
        }
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { flushDelta(); break; }
        try {
          const chunk = JSON.parse(raw);

          // server error chunk — flush pending text first so error replaces final state
          if (chunk.error) {
            flushDelta();
            setAgentState(agentId, (s) => {
              const n = [...s.msgs];
              n[n.length - 1] = { role: "assistant", text: `（${chunk.error}）` };
              return { ...s, msgs: n };
            });
            break;
          }

          // Hermes tool started
          if (chunk.__hermes_tool === "started") {
            setAgentState(agentId, (s) => {
              const n = [...s.msgs];
              const last = n[n.length - 1];
              if (last?.role === "assistant") {
                const tcs = last.toolCalls || [];
                n[n.length - 1] = {
                  ...last,
                  toolCalls: [
                    ...tcs,
                    {
                      id: chunk.id,
                      name: chunk.name,
                      preview: chunk.preview || "",
                      status: "running",
                      ts: Date.now(),
                    },
                  ],
                };
              }
              return { ...s, msgs: n };
            });
            continue;
          }

          // Hermes tool completed
          if (chunk.__hermes_tool === "completed") {
            setAgentState(agentId, (s) => {
              const n = [...s.msgs];
              const last = n[n.length - 1];
              if (last?.role === "assistant" && last.toolCalls?.length) {
                const tcs = [...last.toolCalls];
                const idx = tcs.findLastIndex(
                  (t: HermesToolCall) => t.status === "running",
                );
                if (idx >= 0) {
                  tcs[idx] = {
                    ...tcs[idx],
                    status: chunk.is_error ? "error" : "done",
                    durationMs: chunk.durationMs,
                  };
                }
                n[n.length - 1] = { ...last, toolCalls: tcs };
              }
              return { ...s, msgs: n };
            });
            continue;
          }

          // Hermes reasoning chunk
          if (chunk.__reasoning) {
            setAgentState(agentId, (s) => {
              const n = [...s.msgs];
              const last = n[n.length - 1];
              if (last?.role === "assistant") {
                n[n.length - 1] = {
                  ...last,
                  reasoning: (last.reasoning || "") + chunk.__reasoning,
                };
              }
              return { ...s, msgs: n };
            });
            continue;
          }

          // OpenAI-style content delta — batched at 60fps via scheduleFlush
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) {
            pendingDelta += delta;
            scheduleFlush();
          }

          // Custom status (typing/thinking indicator)
          if (chunk.__status) {
            setAgentState(agentId, (s) => {
              const n = [...s.msgs];
              const last = n[n.length - 1];
              n[n.length - 1] = { ...last, status: chunk.__status };
              return { ...s, msgs: n };
            });
          }
        } catch {
          // chunk parse error: skip silently (don't kill the stream)
        }
      }
    }
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    flushDelta();
  } catch (e: any) {
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    flushDelta(); // preserve any text we already received before erroring
    const isAbort = e?.name === "AbortError";
    setAgentState(agentId, (s) => {
      const n = [...s.msgs];
      if (n.length && n[n.length - 1].role === "assistant" && !n[n.length - 1].text) {
        n[n.length - 1] = {
          role: "assistant",
          text: isAbort ? "（已停止生成）" : (e?.message || "出错了"),
        };
      }
      return { ...s, msgs: n };
    });
  } finally {
    if (controllers.get(agentId) === controller) controllers.delete(agentId);
    setAgentState(agentId, (s) => ({ ...s, streaming: false }));
    try {
      onComplete?.();
    } catch {}
  }
}

/** stopBusinessMessage — abort the in-flight stream for this agent (if any). */
export function stopBusinessMessage(agentId: string): void {
  const c = controllers.get(agentId);
  if (c) {
    c.abort();
    controllers.delete(agentId);
  }
}
