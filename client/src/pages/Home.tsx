/**
 * Home.tsx — Lingxia (员工智能体) Console
 * Renders the sub-claw control panel when accessed via /claw/:adoptId or a lingxia subdomain.
 * The linggan homepage code has been removed (dead code on this server).
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { OpenClawWSClient } from "@/lib/openclaw-ws";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useBrand } from "@/lib/useBrand";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRoute, useLocation } from "wouter";
import { SidebarFooter } from "@/components/SidebarFooter";
import { CollabDrawer } from "@/components/CollabDrawer";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessage, type ToolCallEntry } from "@/components/ChatMessage";
import { AgentTaskCard, type AgentTask } from "@/components/AgentTaskCard";
import { BrandIcon } from "@/components/BrandIcon";
import { Sidebar, type PageKey } from "@/components/console/Sidebar";
import { TopBar } from "@/components/console/TopBar";
import { MainPanel } from "@/components/console/MainPanel";
import { ChatPage } from "@/components/pages/ChatPage";
import { LINGXIA_SIDEBAR_NAV } from "@/config/navigation";
import { sidebarIconMap } from "@/config/icons";
import { applySettings as applyUiSettings, getSettings, subscribeSettings } from "@/lib/settings";
import { useLingxiaChat } from "@/hooks/useLingxiaChat";
import { formatModelName, getModelProviderLabel } from "@/lib/modelDisplay";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";



// ── 2026-04-27: reasoning_content (DeepSeek-V4-Flash 等 reasoning 模型) 累积成虚拟 thinking toolCall ──
// 渲染上完全复用 ChatMessage 现有的 GATEWAY_TOOL_META.thinking + lingxia-toolcard，零 UI 改动。
// 设计要点（防三个真坑）：
//   1) thinking 没显式 end 信号 → 收到 content delta 或 finish_reason=stop 时强制 mark done
//   2) ID 用 ts+index 防同毫秒撞 ID
//   3) 后端不发 tool_call event，纯前端制造，不会被 routeTool 拦截
function applyReasoningDelta(msgs: any[], reasoningDelta: string): any[] {
  if (msgs.length === 0) return msgs;
  const lastIdx = msgs.length - 1;
  const last = msgs[lastIdx];
  if (last.role !== "assistant") return msgs;
  const tcs = (last.toolCalls || []) as any[];
  const running = tcs.find((tc: any) => tc.name === "thinking" && tc.status === "running");
  let newTcs;
  if (running) {
    newTcs = tcs.map((tc: any) => tc === running ? { ...tc, result: (tc.result || "") + reasoningDelta } : tc);
  } else {
    const id = "thinking-" + Date.now() + "-" + tcs.length;
    newTcs = [...tcs, { id, name: "thinking", arguments: "{}", result: reasoningDelta, status: "running" as const, ts: Date.now(), executor: "gateway" as const, _gateway: true }];
  }
  const next = [...msgs];
  next[lastIdx] = { ...last, toolCalls: newTcs };
  return next;
}

function markThinkingDone(msgs: any[]): any[] {
  if (msgs.length === 0) return msgs;
  const lastIdx = msgs.length - 1;
  const last = msgs[lastIdx];
  if (last.role !== "assistant") return msgs;
  const tcs = (last.toolCalls || []) as any[];
  const hasRunning = tcs.some((tc: any) => tc.name === "thinking" && tc.status === "running");
  if (!hasRunning) return msgs;
  const newTcs = tcs.map((tc: any) => (tc.name === "thinking" && tc.status === "running")
    ? { ...tc, status: "done" as const, durationMs: Date.now() - tc.ts }
    : tc);
  const next = [...msgs];
  next[lastIdx] = { ...last, toolCalls: newTcs };
  return next;
}

// 2026-04-28 批次 2 A1：lingxiaMsgs 加稳定 id，恢复时按 id 替换不按 findLastIndex
// 用于 SSE 截断 recover 时精确匹配目标消息——用户在 recover 期间发新消息也不串
const makeLxMsgId = () => `lx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const makeClientRunId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const makeConversationId = () => `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
type UploadedLingxiaAttachment = {
  name: string;
  path: string;
  size: number;
  runtime?: string;
};

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function buildMessageWithUploadedAttachments(text: string, uploads: UploadedLingxiaAttachment[]) {
  if (uploads.length === 0) return text;
  const intro = text.trim() || "请查看我上传的附件。";
  const lines = uploads.map((file) =>
    `- ${file.name} (${formatFileSize(file.size)}) -> workspace path: ${file.path}`
  );
  return [
    intro,
    "",
    "[已上传附件]",
    ...lines,
    "",
    "需要读取附件内容时，请使用上面的 workspace path。",
  ].join("\n");
}
type LxMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timeLabel: string;
  status?: string;
  usage?: { input: number; output: number };
  model?: string;
  contextWindow?: number;
  contextPercent?: number;
  toolCalls?: import("@/components/ChatMessage").ToolCallEntry[];
  // 2026-04-29 批次 2 A3：截断恢复状态（仅 assistant 用）
  recovering?: boolean;
  recovered?: boolean;
  recoveryFailed?: boolean;
  partialText?: string;            // 截断时已显示的内容（恢复失败时保留）
};

function isLingxiaChatV2Enabled(userId?: number | string | null): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const queryFlag = params.get("chatv2");
    if (queryFlag === "1") localStorage.setItem("lingxia_chat_v2", "1");
    if (queryFlag === "0") localStorage.setItem("lingxia_chat_v2", "0");
    if (localStorage.getItem("lingxia_chat_v2") === "0") return false;
    if (localStorage.getItem("lingxia_chat_v2") === "1") return true;
  } catch {}

  const mode = String(import.meta.env.VITE_LINGXIA_CHAT_V2 || "off").toLowerCase();
  if (mode === "on") return true;
  if (mode === "allowlist") {
    const ids = String(import.meta.env.VITE_LINGXIA_CHAT_V2_USERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return !!userId && ids.includes(String(userId));
  }
  return false;
}

const backfillLxMsgIds = (raw: any): LxMsg[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((m: any) => ({
    ...m,
    id: typeof m?.id === "string" && m.id ? m.id : makeLxMsgId(),
    role: m?.role === "assistant" ? "assistant" : "user",
    text: String(m?.text ?? ""),
    timeLabel: String(m?.timeLabel ?? new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })),
    // 2026-04-29 批次 2 A3：重载后清空 recovering 瞬态——刷新前正在补偿的消息视为失败，避免 UI 卡住
    recovering: false,
  }));
};

// ── 2026-04-29 批次 2 A3：SSE 截断后恢复 ────────────────────────────
// 收到 __stream_truncated 事件时启动短轮询 /api/claw/recover-status，
// 拿到 OpenClaw trajectory 完整 assistantTexts 后按 lingxiaMsgs.id 替换。
// 调用方需传入当前 lingxiaMsgs snapshot（来自 ref.current）——不能依赖
// setState updater 闭包来抓 id（React 18 concurrent 下 updater 不保证同步执行）。
async function handleStreamTruncated(
  truncEvt: { adoptId?: string; streamEndMs?: number; chatCompletionId?: string | null },
  currentMsgs: LxMsg[],
  setLingxiaMsgs: React.Dispatch<React.SetStateAction<LxMsg[]>>,
): Promise<void> {
  const { adoptId, streamEndMs, chatCompletionId } = truncEvt;
  if (!adoptId || typeof streamEndMs !== "number") {
    console.warn("[recover] missing fields in __stream_truncated:", truncEvt);
    return;
  }

  // 直接从 currentMsgs (caller 已传 ref.current) 抓最后 assistant id —— 不走 setState 副作用
  const lastIdx = currentMsgs.length - 1;
  if (lastIdx < 0 || currentMsgs[lastIdx].role !== "assistant") {
    console.warn("[recover] no last assistant message in current snapshot");
    return;
  }
  const myId = currentMsgs[lastIdx].id;
  const partialSnapshot = currentMsgs[lastIdx].text;

  // 标 recovering——按 id 找，因为到 updater 跑时数组顺序可能已变（用户瞬时发新消息）
  setLingxiaMsgs((prev) => {
    const idx = prev.findIndex((m) => m.id === myId);
    if (idx < 0) return prev;
    const next = [...prev];
    next[idx] = {
      ...next[idx],
      recovering: true,
      partialText: partialSnapshot,
      text: (partialSnapshot || "") + "\n\n_⏳ 上游连接提前结束，正在从 OpenClaw 后台补全完整内容（最多 5 分钟）..._",
    };
    return next;
  });
  console.log("[recover] start polling for", myId, { adoptId, streamEndMs, chatCompletionId });

  const MAX_ATTEMPTS = 60;   // 5 分钟 / 5 秒 = 60 次（约束 #4）
  const INTERVAL_MS = 5000;
  let attempts = 0;

  const poll = async () => {
    if (attempts >= MAX_ATTEMPTS) {
      console.warn("[recover] timeout after", MAX_ATTEMPTS, "attempts");
      setLingxiaMsgs((msgs) => msgs.map((m) =>
        m.id === myId
          ? {
              ...m,
              recovering: false,
              recoveryFailed: true,
              text: (m.partialText || m.text) +
                "\n\n_⚠️ 内容补偿超时（5 分钟），可重试或查看 Workspace 产物_",
            }
          : m
      ));
      return;
    }
    attempts++;
    try {
      const r = await fetch("/api/claw/recover-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adoptId,
          streamEndMs,
          chatCompletionId: chatCompletionId ?? null,
        }),
      });
      const d = await r.json();
      if (d.status === "ready") {
        const recovered = String(d.text || "");
        console.log("[recover] ✅ ready, replacing", recovered.length, "chars (matchType=" + d.matchType + ")");
        setLingxiaMsgs((msgs) => msgs.map((m) =>
          m.id === myId
            ? { ...m, recovering: false, recovered: true, text: recovered, partialText: undefined }
            : m
        ));
        return;
      }
      if (d.status === "failed") {
        console.warn("[recover] ❌ failed:", d);
        setLingxiaMsgs((msgs) => msgs.map((m) =>
          m.id === myId
            ? {
                ...m,
                recovering: false,
                recoveryFailed: true,
                text: (m.partialText || m.text) +
                  `\n\n_⚠️ 内容补偿失败：${d.finalStatus || d.reason || "unknown"}，可重试或查看 Workspace 产物_`,
              }
            : m
        ));
        return;
      }
      // pending 继续轮询
      setTimeout(poll, INTERVAL_MS);
    } catch (e: any) {
      console.warn("[recover] poll error:", e?.message);
      setTimeout(poll, INTERVAL_MS);
    }
  };
  // 第一次也等 5s——给 OpenClaw 写 trace.artifacts 留时间
  setTimeout(poll, INTERVAL_MS);
}

export default function Home() {
  // 员工智能体子域名聊天态（MVP）
  const brand = useBrand();
  const { confirm, dialog } = useConfirmDialog();
  const [lingxiaInput, setLingxiaInput] = useState("");
  const [lingxiaMsgs, setLingxiaMsgs] = useState<LxMsg[]>([]);
  // 2026-04-29 批次 2 A3：mirror ref 用于 SSE 异步 handler 拿稳定 snapshot
  // React 18 concurrent 下 setState updater 不保证同步执行，不能在 updater 里抓 id 给外层用
  const lingxiaMsgsRef = useRef<LxMsg[]>(lingxiaMsgs);
  useEffect(() => { lingxiaMsgsRef.current = lingxiaMsgs; }, [lingxiaMsgs]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [lingxiaToolCalls, setLingxiaToolCalls] = useState<ToolCallEntry[]>([]);
  const [lingxiaShowToolCalls, setLingxiaShowToolCalls] = useState(true);
  const [lingxiaDisplayName, setLingxiaDisplayName] = useState(brand.name);
  const identityNameRef = useRef<string>("");
    const [lingxiaMemoryEnabled, setLingxiaMemoryEnabled] = useState<"yes" | "no">("yes");
  const [lingxiaContextTurns, setLingxiaContextTurns] = useState(20);
  const [lingxiaModelId, setLingxiaModelId] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);
  const [openclawVersion, setOpenclawVersion] = useState("v2026.3.27");
  const [runtimeAgentId, setRuntimeAgentId] = useState("");
  const prettyRuntimeAgentName = (agentId: string) => {
    const s = String(agentId || "").trim();
    if (!s) return "";
    return s.replace(/^trial_/, "").replace(/^lgc-/, "");
  };
  const [activePage, setActivePage] = useState<PageKey>(() => {
    // 支持别的页面（例如 CoopSession 返回按钮）通过 sessionStorage 指定首次落地的 page
    try {
      const v = sessionStorage.getItem("home_initial_page");
      if (v) {
        sessionStorage.removeItem("home_initial_page");
        if (v === "agentLab") return "chat";
        return v as PageKey;
      }
    } catch {}
    return "chat";
  });

  // Step 6 扩展：主聊天 @ 触发协作的状态
  const [, setLocationCoop] = useLocation();
  const [mentionedUsers, setMentionedUsers] = useState<Array<{userId: number; userName: string; groupName: string | null; orgName: string | null; adoptId: string | null}>>([]);
  const coopCreateFromChatMut = trpc.coop.create.useMutation({
    onSuccess: (r) => {
      setMentionedUsers([]);
      setLingxiaInput("");
      toast.success("已发起协作");
      setLocationCoop(`/coop/${r.sessionId}`);
    },
    onError: (e) => toast.error(e.message || "协作创建失败"),
  });

    // Step 6: 侧栏协作红点（pendingCount 每 30s 刷新；WS 推入未来版）
  const { data: coopPending } = trpc.coop.pendingCount.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const coopBadgeCount = (coopPending?.pendingMyApproval || 0) + (coopPending?.awaitingMyConsolidation || 0);

  const [collabOpen, setCollabOpen] = useState(false);

  useEffect(() => {
    const initial = getSettings();
    setSidebarCollapsed(initial.navCollapsed);
    setSidebarWidth(initial.navWidth);
    return subscribeSettings((st) => {
      setSidebarCollapsed(st.navCollapsed);
      setSidebarWidth(st.navWidth);
    });
  }, []);

  useEffect(() => {
    applyUiSettings({ navCollapsed: sidebarCollapsed, navWidth: sidebarWidth });
  }, [sidebarCollapsed, sidebarWidth]);
  const [lingxiaOpenSections, setLingxiaOpenSections] = useState<Set<string>>(new Set(["soul"]));
  const toggleLingxiaSection = (s: string) => setLingxiaOpenSections(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const [lingxiaTopSettingsOpen, setLingxiaTopSettingsOpen] = useState(false);

  const { user } = useAuth({ redirectOnUnauthenticated: false });

  // ── adoptId 提取：子域名模式 OR 路径模式 ──
  const currentHost = window.location.hostname.toLowerCase();
  const adoptIdFromHost = useMemo(() => {
    const m = currentHost.match(/^(lgc-[a-z0-9-]+)\.(?:demo\.linggantest\.top|demo\.linggan\.top)$/i);
    return m?.[1] || null;
  }, [currentHost]);
  // 路径模式：/claw/:adoptId
  const [isClawRoute, clawRouteParams] = useRoute("/claw/:adoptId");
  const adoptIdFromPath = isClawRoute ? clawRouteParams?.adoptId || null : null;
  // 合并：子域名优先，路径兜底
  const resolvedAdoptId = adoptIdFromHost || adoptIdFromPath;
  const isLingxiaSubdomain = !!resolvedAdoptId;
  const webConversationId = useMemo(() => {
    if (!resolvedAdoptId) return "";
    const key = `lingxia_web_conversation_${resolvedAdoptId}`;
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const next = makeConversationId();
      sessionStorage.setItem(key, next);
      return next;
    } catch {
      return makeConversationId();
    }
  }, [resolvedAdoptId]);

  const { data: clawByAdoptId, isLoading: clawByAdoptLoading } = trpc.claw.getByAdoptId.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const { data: clawSettings, refetch: refetchClawSettings } = trpc.claw.getSettings.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const { data: availableModels } = trpc.claw.getAvailableModels.useQuery(undefined, { retry: false, refetchInterval: 30000, refetchOnWindowFocus: true, refetchOnMount: true });
  // 模型兜底：优先用户在前端选过的偏好（claw-model-overrides.json），其次 isDefault，最后第一个
  // 修复刷新后下拉强制回 GLM5.1 但 OpenClaw 实际跑用户上次选的 model 的前后端不一致 bug
  useEffect(() => {
    if (!availableModels || availableModels.length === 0) return;
    const ids = (availableModels as any[]).map((m: any) => m.id);
    if (!lingxiaModelId || !ids.includes(lingxiaModelId)) {
      // 优先：用户在前端选过的 model（持久化在 data/claw-model-overrides.json，由 getSettings 返回）
      const userPref = (clawSettings as any)?.model;
      if (userPref && ids.includes(userPref)) {
        setLingxiaModelId(userPref);
        return;
      }
      const defaultModel = (availableModels as any[]).find((m: any) => m.isDefault);
      setLingxiaModelId(defaultModel ? defaultModel.id : ids[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels, clawSettings]);

  const switchModelMutation = trpc.claw.switchModel.useMutation({
    retry: false,
    onSuccess: () => toast.success("模型已切换"),
    onError: (e) => toast.error(e.message || "切换模型失败"),
  });
  const updateClawSettingsMutation = trpc.claw.updateSettings.useMutation({
    retry: false,
    onSuccess: () => {
      refetchClawSettings();
      toast.success("员工智能体设置已保存");
    },
  });

  // 流式聊天状态（替换原 tRPC mutation）
  const [lingxiaStreaming, setLingxiaStreaming] = useState(false);
  const lingxiaStreamAbortRef = useRef<AbortController | null>(null);
  // 2026-04-19 SSE race fix: 每次 send 自增 seq，handler 用闭包抓 myStreamSeq，
  // 只有 streamSeqRef.current === myStreamSeq 时才写 state；否则视为 stale 事件早退。
  const streamSeqRef = useRef(0);
  const wsClientRef = useRef<OpenClawWSClient | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // lgh-* 虾是 Hermes runtime，不走 OpenClaw WSS；直接 HTTP SSE 由 server 侧 prefix 分叉到 hermes-bridge
  const isHermesRuntime = String(resolvedAdoptId || "").startsWith("lgh-");
  const chatV2Enabled = isLingxiaChatV2Enabled((user as any)?.id);
  const chatV2 = useLingxiaChat({
    adoptId: resolvedAdoptId,
    channel: webConversationId ? "web" : undefined,
    conversationId: webConversationId || undefined,
    isHermesRuntime,
    memoryEnabled: lingxiaMemoryEnabled === "yes",
    contextTurns: lingxiaContextTurns,
  });
  const activeLingxiaMsgs = chatV2Enabled ? chatV2.messages : lingxiaMsgs;
  const activeLingxiaStreaming = chatV2Enabled ? chatV2.isStreaming : lingxiaStreaming;
  const uploadLingxiaAttachments = async (files: File[]): Promise<UploadedLingxiaAttachment[]> => {
    if (!files.length) return [];
    if (!resolvedAdoptId) throw new Error("缺少员工智能体实例 ID");
    const apiBase = import.meta.env.VITE_API_URL || "";
    const uploads: UploadedLingxiaAttachment[] = [];

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`${file.name} 超过 10MB 上传限制`);
      }
      const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const response = await fetch(`${apiBase}/api/claw/files/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adoptId: resolvedAdoptId,
          filename: file.name,
          contentBase64,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `${file.name} 上传失败 (${response.status})`);
      }
      uploads.push({
        name: file.name,
        path: String(payload.path || file.name),
        size: Number(payload.size || file.size),
        runtime: payload.runtime ? String(payload.runtime) : undefined,
      });
    }

    return uploads;
  };

  // 初始化 WSS 连接（后台自动尝试，不阻塞 UI）—— 仅 OpenClaw (lgc-*)
  useEffect(() => {
    if (!resolvedAdoptId || !webConversationId || isHermesRuntime || chatV2Enabled) return;
    const apiBase = (import.meta as any).env?.VITE_API_URL || "";
    const ws = new OpenClawWSClient(resolvedAdoptId, apiBase, { channel: "web", conversationId: webConversationId });
    wsClientRef.current = ws;
    ws.connect().then((ok) => { if (ok) setWsConnected(true); });
    return () => { ws.disconnect(); wsClientRef.current = null; setWsConnected(false); };
  }, [resolvedAdoptId, webConversationId, isHermesRuntime, chatV2Enabled]);
  const lingxiaMsgViewportRef = useRef<HTMLDivElement | null>(null);
  const [lingxiaNearBottom, setLingxiaNearBottom] = useState(true);
  // 工具执行显性化状态
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activeToolStartMs, setActiveToolStartMs] = useState<number | null>(null);
  const [activeToolElapsed, setActiveToolElapsed] = useState(0); // 秒数
  const [activeToolStep, setActiveToolStep] = useState<number | null>(null);    // 第二阶段：当前步骤
  const [activeToolTotal, setActiveToolTotal] = useState<number | null>(null);  // 第二阶段：总步骤
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);  // 第二阶段：当前阶段文案
  const [connStatus, setConnStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
  const lastEventAtRef = useRef<number>(Date.now()); // 追踪最后收到的任意 SSE 事件时间

  // 技能列表
  const { data: lingxiaSkills, refetch: refetchSkills } = trpc.claw.listSkills.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const toggleSkillMutation = trpc.claw.toggleSkill.useMutation({
    onSuccess: () => { refetchSkills(); toast.success("技能已更新"); },
    onError: (e) => toast.error(e.message),
  });
  const upsertPrivateSkillMutation = trpc.claw.upsertPrivateSkill.useMutation({
    onSuccess: () => { refetchSkills(); setLingxiaSkillEditor(null); toast.success("技能已保存"); },
    onError: (e) => toast.error(e.message),
  });
  const deletePrivateSkillMutation = trpc.claw.deletePrivateSkill.useMutation({
    onSuccess: () => { refetchSkills(); toast.success("技能已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const [lingxiaSkillEditor, setLingxiaSkillEditor] = useState<{ id: string; content: string } | null>(null);

  // localStorage 会话持久化
  const MSGS_KEY = resolvedAdoptId && webConversationId ? `lgc_msgs_${resolvedAdoptId}_${webConversationId}` : null;
  useEffect(() => {
    if (!MSGS_KEY) return;
    try {
      const saved = localStorage.getItem(MSGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // backfillLxMsgIds 会保留旧 id（如果有）或生成新 id，并兜底必填字段
        const normalized = backfillLxMsgIds(parsed);
        setLingxiaMsgs(normalized);
      } else {
        setLingxiaMsgs([]);
      }
    } catch {}
  }, [MSGS_KEY]);
  useEffect(() => {
    if (!MSGS_KEY) return;
    try {
      if (lingxiaMsgs.length === 0) {
        localStorage.removeItem(MSGS_KEY);
      } else {
        // 不持久化 recovering 瞬态——刷新后重新加载时清空，避免 UI 卡在补偿中
        // 同时把 text 还原为 partialText（去掉"正在补全..."提示），避免刷新看到不会推进的虚假提示
        const persisted = lingxiaMsgs.slice(-100).map((m) => {
          if (!m.recovering) return m;
          return {
            ...m,
            recovering: false,
            text: m.partialText ?? m.text,
            partialText: undefined,
          };
        });
        localStorage.setItem(MSGS_KEY, JSON.stringify(persisted));
      }
    } catch {}
  }, [lingxiaMsgs, MSGS_KEY]);


  useEffect(() => {
    if (!clawSettings) return;
    if (!identityNameRef.current) setLingxiaDisplayName(String((clawSettings as any).displayName || (clawByAdoptId as any)?.displayName || brand.name));
        setLingxiaMemoryEnabled(((clawSettings as any).memoryEnabled || "yes") as "yes" | "no");
    setLingxiaContextTurns(Number((clawSettings as any).contextTurns || 20));
    // 模型选择由 availableModels useEffect 统一管理
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clawSettings, clawByAdoptId]);

  // 从 IDENTITY.md 读取角色名（覆盖 clawSettings 的 displayName）
  useEffect(() => {
    if (!resolvedAdoptId) return;
    const apiBase = (import.meta as any).env?.VITE_API_URL || "";
    fetch(`${apiBase}/api/claw/core-files/read?adoptId=${encodeURIComponent(resolvedAdoptId)}&name=IDENTITY.md`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.content) return;
        const content: string = d.content;
        // 格式: **Name:** XXX 或 - **Name:** XXX
        const nameFieldMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
        const headingMatch = content.match(/^#\s+(?:我叫|名字[：:]?\s*)?(.+)/m);
        const labelMatch = content.match(/(?:名字|名称|称呼)[：:]\s*(.+)/);
        const sentenceMatch = content.match(/我叫([^\s，。！？,\.!?]{1,20})/);
        const name = (nameFieldMatch?.[1] || headingMatch?.[1] || labelMatch?.[1] || sentenceMatch?.[1] || "").trim();
        if (name) { identityNameRef.current = name; setLingxiaDisplayName(name); }
      })
      .catch(() => {});
  }, [resolvedAdoptId]);


  const stopLingxiaStreaming = () => {
    streamSeqRef.current += 1;
    if (lingxiaStreamAbortRef.current) {
      lingxiaStreamAbortRef.current.abort();
      lingxiaStreamAbortRef.current = null;
    }
    try { wsClientRef.current?.setRawHandler(null); } catch {}
    setLingxiaStreaming(false);
    setConnStatus("connected");
    setActiveToolName(null);
    setActiveToolStartMs(null);
    setActiveToolElapsed(0);
  };

  // 工具执行计时器：activeToolStartMs 有值时每秒更新 elapsed
  useEffect(() => {
    if (activeToolStartMs === null) return;
    const tick = () => setActiveToolElapsed(Math.floor((Date.now() - activeToolStartMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeToolStartMs]);

  // 断连检测：任意 SSE 事件超过 25 秒未到达 → 进入"重连中"
  useEffect(() => {
    if (!lingxiaStreaming) return;
    const id = setInterval(() => {
      if (Date.now() - lastEventAtRef.current > 90_000) {
        setConnStatus("reconnecting");
      }
    }, 5000);
    return () => clearInterval(id);
  }, [lingxiaStreaming]);

  const sendLingxiaMessage = async (messageOverride?: string) => {
    const sourceText = messageOverride ?? lingxiaInput;
    if (!resolvedAdoptId || !sourceText.trim() || lingxiaStreaming) return;
    if (chatV2Enabled) return;
    // 2026-04-17 SSE race fix: 强制 abort 上一次的流，避免 WS 重连/网络抖动后旧 reader 还在
    // setLingxiaMsgs 写 delta，跟新流字符级交错（典型现象：英文 narrative + 中文技能列表混合）
    if (lingxiaStreamAbortRef.current) {
      try { lingxiaStreamAbortRef.current.abort(); } catch {}
      lingxiaStreamAbortRef.current = null;
    }
    // 2026-04-19 SSE race fix: 本次 send 的 seq，闭包下传所有 handler
    streamSeqRef.current += 1;
    const myStreamSeq = streamSeqRef.current;
    const isStale = () => streamSeqRef.current !== myStreamSeq;
    const text = sourceText.trim();
    const nowLabel = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const assistantTimeLabel = nowLabel;

    if (text.toLowerCase() === "/help" || text.toLowerCase() === "/commands") {
      const helpMd = "## \u53ef\u7528\u547d\u4ee4\n\n" +
        "| \u547d\u4ee4 | \u8bf4\u660e |\n|---|---|\n" +
        "| \`/help\` | \u67e5\u770b\u53ef\u7528\u547d\u4ee4 |\n" +
        "| \`/status\` | \u67e5\u770b\u5f53\u524d\u72b6\u6001 |\n" +
        "| \`/tools\` | \u67e5\u770b\u53ef\u7528\u5de5\u5177 |\n" +
        "| \`/model\` | \u5207\u6362\u6a21\u578b |\n" +
        "| \`/dreaming status\` | \u68a6\u5883\u8bb0\u5fc6\u72b6\u6001 |\n" +
        "| \`/context\` | \u4e0a\u4e0b\u6587\u4fe1\u606f |\n" +
        "| \`/usage\` | \u7528\u91cf\u7edf\u8ba1 |\n" +
        "| \`/whoami\` | \u5f53\u524d\u8eab\u4efd |\n" +
        "| \`/new\` | \u65b0\u4f1a\u8bdd |\n" +
        "| \`/reset\` | \u91cd\u7f6e\u4e0a\u4e0b\u6587 |\n" +
        "| \`/think\` | \u6df1\u5ea6\u601d\u8003 |\n" +
        "| \`/fast\` | \u5feb\u901f\u6a21\u5f0f |\n" +
        "| \`/compact\` | \u538b\u7f29\u4e0a\u4e0b\u6587 |\n" +
        "| \`/tasks\` | \u4efb\u52a1\u5217\u8868 |\n\n" +
        "> \u4e5f\u53ef\u4ee5\u76f4\u63a5\u7528\u81ea\u7136\u8bed\u8a00\u5bf9\u8bdd";
      setLingxiaMsgs((prev) => [...prev,
        { id: makeLxMsgId(), role: "user" as const, text, timeLabel: nowLabel },
        { id: makeLxMsgId(), role: "assistant" as const, text: helpMd, timeLabel: assistantTimeLabel },
      ]);
      setLingxiaInput("");
      return;
    }

    const userMessageId = makeLxMsgId();
    const assistantMessageId = makeLxMsgId();
    const clientRunId = makeClientRunId();
    setLingxiaMsgs((prev) => [
      ...prev,
      { id: userMessageId, role: "user", text, timeLabel: nowLabel },
      { id: assistantMessageId, role: "assistant", text: "", timeLabel: assistantTimeLabel },
    ]);
    setLingxiaInput("");
    setLingxiaStreaming(true);
    setLingxiaNearBottom(true);
    setLingxiaToolCalls([]);

    let wsOk = false;
    try {
      const apiBase = import.meta.env.VITE_API_URL || "";
      const perf: Record<string, number> = { clientSendMs: Date.now() };
      const controller = new AbortController();
      lingxiaStreamAbortRef.current = controller;
      // ── WSS 优先路径（仅 OpenClaw runtime） ──
      // Hermes (lgh-*) 跳过 WSS 尝试，直接走 HTTP SSE（server 会 prefix 分叉到 hermes-bridge）
      const wsClient = isHermesRuntime ? null : wsClientRef.current;
      console.log(`[DIAG] runtime=${isHermesRuntime ? "hermes" : "openclaw"}, wsClient.state = ${wsClient?.state ?? "null"}, will ${wsClient?.state === "connected" ? "try WSS first" : "use HTTP SSE directly"}`);
      if (wsClient?.state === "connected") {
        console.log("[WS] sending via WebSocket");
        // WS 消息处理：后端 WS 代理已转成与 HTTP SSE 一致的格式
        // _event 字段 = SSE 的 event: 行，其余字段 = SSE 的 data: JSON
        // 用 setRawHandler 代替 addEventListener，跨重连自动保持
          const wsHandler = (chunk: any) => {
            try {
              // SSE race fix: 老流的 chunk 直接早退，不写新 placeholder
              if (isStale()) return;
              if (chunk.type === "connected") return;
              lastEventAtRef.current = Date.now();

              // ── 统一语义：流结束 ──
              if (chunk.__stream_end) {
                console.log("[DIAG] ✅ WSS 收到 __stream_end，流结束");
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // ── 2026-04-29 批次 2 A3：上游 EOF 但 runtime 未确认完成 ──
              if (chunk.__stream_truncated) {
                console.log("[DIAG] ⚠️ WSS 收到 __stream_truncated，启动 recover:", chunk);
                handleStreamTruncated(chunk, lingxiaMsgsRef.current, setLingxiaMsgs);
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // ── 长度上限达到（finish_reason: length）──
              if (chunk.__stream_end_length) {
                console.log("[DIAG] ⚠️ WSS 收到 __stream_end_length");
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: last.text + "\n\n_⚠️ 已达模型长度上限，输出可能不完整_" }; return n; });
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // ── 统一语义：终止性错误 ──
              if (chunk.__stream_error) {
                console.log("[DIAG] ❌ WSS 收到 __stream_error:", chunk.error);
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: `（${chunk.error || "连接异常"}）` }; return n; });
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // 错误（旧兼容）
              if (chunk.error) {
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: `（${chunk.error}）` }; return n; });
                setLingxiaStreaming(false);
                return;
              }

              // ── tool_call 事件（与 HTTP SSE event:tool_call 一致）──
              
              // ── Agent Team 事件 ──
              if (chunk._event === "agent_dispatch") {
                const tasks = (chunk.agents || []).map((a: any) => ({
                  id: a.id, agentId: a.agentId, agentName: a.name, prompt: a.prompt || "",
                  status: "running", steps: [], result: undefined, durationMs: undefined,
                }));
                setAgentTasks(tasks);
                return;
              }
              if (chunk._event === "agent_tool_update") {
                setAgentTasks((prev) => prev.map((t) =>
                  t.id === chunk.taskId ? {
                    ...t,
                    steps: chunk.toolStatus === "started"
                      ? [...t.steps, { name: chunk.toolName || "tool", status: "running" }]
                      : t.steps.map((s) => s.name === (chunk.toolName || "tool") && s.status === "running"
                          ? { ...s, status: "done", durationMs: chunk.durationMs } : s),
                  } : t
                ));
                return;
              }
              if (chunk._event === "agent_complete") {
                setAgentTasks((prev) => prev.map((t) =>
                  t.id === chunk.taskId ? {
                    ...t, status: "done", result: chunk.result || "", durationMs: chunk.durationMs,
                    steps: t.steps.map((s) => s.status === "running" ? { ...s, status: "done" } : s),
                  } : t
                ));
                return;
              }
              if (chunk._event === "tool_call") {
                const toolName = String(chunk.name || "unknown");
                const toolTs = Date.now();
                const isGateway = Boolean(chunk._gateway);
                setLingxiaMsgs((prev) => {
                  const next = [...prev]; const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: String(chunk.arguments || "{}"), status: "running" as const, ts: toolTs, _gateway: isGateway, executor: isGateway ? "gateway" : undefined }] };
                  }
                  return next;
                });
                if (!isGateway) {
                  setActiveToolName(toolName);
                  setActiveToolStartMs(toolTs);
                  setActiveToolElapsed(0);
                  setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null);
                }
                return;
              }

              // ── tool_result 事件（与 HTTP SSE event:tool_result 一致）──
              if (chunk._event === "tool_result") {
                const toolCallId = String(chunk.tool_call_id || "");
                const result = String(chunk.result ?? "");
                const isGateway = Boolean(chunk._gateway);
                const status = chunk.is_error ? "error" : "done";
                if (isGateway) {
                  setLingxiaMsgs((prev) => {
                    const next = [...prev]; const lastIdx = next.length - 1;
                    if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                      const tcs = next[lastIdx].toolCalls || [];
                      const gwIdx = tcs.findLastIndex((tc: any) => tc._gateway && tc.status === "running");
                      if (gwIdx >= 0) { const updated = [...tcs]; updated[gwIdx] = { ...updated[gwIdx], status: "done", durationMs: Date.now() - updated[gwIdx].ts }; next[lastIdx] = { ...next[lastIdx], toolCalls: updated }; }
                    }
                    return next;
                  });
                } else {
                  setLingxiaMsgs((prev) => {
                    const next = [...prev]; const lastIdx = next.length - 1;
                    if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                      const tcs = next[lastIdx].toolCalls || [];
                      next[lastIdx] = { ...next[lastIdx], toolCalls: tcs.map((tc: any) => tc.id === toolCallId ? { ...tc, result, status, durationMs: Date.now() - tc.ts, executor: chunk.executor, truncated: Boolean(chunk.truncated), outputFiles: chunk.outputFiles, adoptId: resolvedAdoptId ?? undefined } : tc) };
                    }
                    return next;
                  });
                  setActiveToolName(null); setActiveToolStartMs(null);
                  setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null);
                }
                return;
              }

              // ── workspace_files 事件 ──
              if (chunk._event === "workspace_files") {
                const wsFiles = Array.isArray(chunk.files) ? chunk.files : [];
                const wsAdoptId = String(chunk.adoptId || "");
                if (wsFiles.length > 0) {
                  const pseudoTc: any = { id: `ws-files-${Date.now()}`, name: "[产出文件]", arguments: "{}", result: wsFiles.map((f: any) => f.name).join(", "), status: "done", ts: Date.now(), executor: "native", outputFiles: wsFiles.map((f: any) => ({ name: f.name, size: f.size, wsPath: f.path })), adoptId: wsAdoptId };
                  setLingxiaMsgs((prev) => { const next = [...prev]; const lastIdx = next.length - 1; if (lastIdx >= 0 && next[lastIdx].role === "assistant") { const existing = next[lastIdx].toolCalls || []; next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, pseudoTc] }; } return next; });
                }
                return;
              }

              // ── agent_status 事件（进度条）──
              if (chunk._event === "agent_status") {
                if (chunk.kind === "heartbeat") {
                  if (chunk.tool) setActiveToolName(String(chunk.tool));
                  if (chunk.elapsedMs) { setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs)); setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000)); }
                } else if (chunk.kind === "progress") {
                  if (chunk.tool) setActiveToolName(String(chunk.tool));
                  if (chunk.step != null) setActiveToolStep(Number(chunk.step));
                  if (chunk.total != null) setActiveToolTotal(Number(chunk.total));
                  if (chunk.label) setActiveToolLabel(String(chunk.label));
                  if (chunk.elapsedMs) { setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs)); setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000)); }
                }
                return;
              }

              // ── __perf 事件（token 用量）──
              if (chunk.__perf && typeof chunk.__perf === "object") {
                setLingxiaMsgs(prev => {
                  if (!prev.length || prev[prev.length - 1].role !== "assistant") return prev;
                  const last = prev[prev.length - 1];
                  const input = chunk.__perf.usage?.input ?? chunk.__perf.usage?.inputTokens ?? last.usage?.input ?? 0;
                  const output = chunk.__perf.usage?.output ?? chunk.__perf.usage?.outputTokens ?? last.usage?.output ?? 0;
                  const contextWindow = chunk.__perf.usage?.contextWindow ?? last.contextWindow;
                  const nextModel = chunk.__perf.model && chunk.__perf.model !== "gateway-injected" ? chunk.__perf.model : last.model;
                  return [...prev.slice(0, -1), { ...last, usage: { input, output }, model: nextModel, contextWindow, contextPercent: contextWindow && input > 0 ? Math.min(Math.round((input / contextWindow) * 100), 100) : last.contextPercent }];
                });
                return;
              }

              // __status（纯文本状态）
              if (chunk.__status) {
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, status: chunk.__status }; return n; });
                return;
              }

              // reasoning_content delta（DeepSeek 等 reasoning 模型）→ 虚拟 thinking toolCall
              const reasoningDelta = chunk?.choices?.[0]?.delta?.reasoning_content;
              if (typeof reasoningDelta === "string" && reasoningDelta) {
                setLingxiaMsgs((prev) => applyReasoningDelta(prev, reasoningDelta));
              }
              // 文本 delta
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (delta) {
                // 收到 content delta → reasoning 阶段结束，mark thinking done
                setLingxiaMsgs((prev) => markThinkingDone(prev));
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: last.text + delta, status: undefined }; return n; });
              }
              // 完成
              if (chunk?.choices?.[0]?.finish_reason === "stop") {
                // 双保险：finish_reason=stop 也兜底 mark thinking done
                setLingxiaMsgs((prev) => markThinkingDone(prev));
                console.log("[DIAG] ✅ WSS finish_reason=stop，流结束");
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
              }
            } catch {}
          };
          wsClient.setRawHandler(wsHandler);
        const sent = wsClient.sendChat(text, undefined, { clientRunId, userMessageId, channel: "web", conversationId: webConversationId });
        if (sent) {
          // WSS 响应超时检测：企业代理可能静默拦截 WSS 数据
          // 等待第一个有效事件，超时则降级到 HTTP SSE
          const WSS_FIRST_EVENT_TIMEOUT_MS = 15000;
          const firstEventOk = await new Promise<boolean>((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => {
              if (!resolved) { resolved = true; resolve(false); }
            }, WSS_FIRST_EVENT_TIMEOUT_MS);
            const origHandler = wsHandler;
            wsClient.setRawHandler((chunk: any) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(true);
              }
              origHandler(chunk);
            });
          });

          if (!firstEventOk) {
            // OpenClaw 2026.4.29 can take 60-120s before the first stream event.
            // Once WSS send succeeds, do not HTTP-fallback and submit the same turn twice.
            console.warn("[WS] first event wait elapsed; keeping WSS active", { clientRunId });
          }
          // WSS submitted successfully; subsequent events are handled by wsHandler.
          wsOk = true;
          return;
        } else {
          console.log("[WS] send failed, falling back to HTTP");
        }
      }

      // ── HTTP SSE 路径（fallback）──
      console.log("[DIAG] 📡 进入 HTTP SSE 路径");
      const resp = await fetch(`${apiBase}/api/claw/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ adoptId: resolvedAdoptId, message: text, model: lingxiaModelId, clientRunId, channel: "web", conversationId: webConversationId }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`请求失败 (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pendingDelta = "";
      let flushTimer: number | null = null;
      let firstChunkFlushed = false;

      const flushDelta = () => {
        // SSE race fix: 老流的累积 delta 扔掉，不污染新 placeholder
        if (isStale()) { pendingDelta = ""; return; }
        if (!pendingDelta) return;
        if (!perf.firstPaintMs) perf.firstPaintMs = Date.now();
        const delta = pendingDelta;
        pendingDelta = "";
        setLingxiaMsgs((prev) => {
          const next = [...prev];
          if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
          next[next.length - 1] = {
            ...next[next.length - 1],
            text: next[next.length - 1].text + delta,
          };
          return next;
        });
      };

      const scheduleFlush = () => {
        if (!firstChunkFlushed) {
          firstChunkFlushed = true;
          flushDelta();
          return;
        }
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushDelta();
        }, 16);
      };

      let currentEvent = ""; // fix: 跨 chunk 保持 SSE event 状态
      let sseDone = false;
      while (!sseDone) {
        const { done, value } = await reader.read();
        if (done) break;
        // SSE race fix: 已被新 send 踢掉，立刻停止解析
        if (isStale()) { sseDone = true; break; }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";


        for (const line of lines) {
          // SSE event 标签行
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") {
            console.log("[DIAG] ✅ 收到 [DONE]，流结束");
            flushDelta();
            sseDone = true;
            break;
          }
          try {
            const chunk = JSON.parse(raw);
            lastEventAtRef.current = Date.now(); // 任意事件进来，重置断连计时
            if (currentEvent === "agent_status") {
              if (chunk.kind === "heartbeat") {
                if (chunk.tool) setActiveToolName(String(chunk.tool));
                if (chunk.elapsedMs) {
                  setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs));
                  setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000));
                }
              } else if (chunk.kind === "progress") {
                // 第二阶段：进度信号 → 更新 step/total/label
                if (chunk.tool) setActiveToolName(String(chunk.tool));
                if (chunk.step != null) setActiveToolStep(Number(chunk.step));
                if (chunk.total != null) setActiveToolTotal(Number(chunk.total));
                if (chunk.label) setActiveToolLabel(String(chunk.label));
                if (chunk.elapsedMs) {
                  setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs));
                  setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000));
                }
              }
              currentEvent = "";
              continue;
            }
            if (chunk?.__perf && typeof chunk.__perf === "object") {
              Object.assign(perf, chunk.__perf);
              // 改动3: 不可写回 message（usage/model/context）
              setLingxiaMsgs(prev => {
                if (!prev.length || prev[prev.length - 1].role !== "assistant") return prev;
                const last = prev[prev.length - 1];
                const input =
                  chunk.__perf.usage?.input ?? chunk.__perf.usage?.inputTokens ?? last.usage?.input ?? 0;
                const output =
                  chunk.__perf.usage?.output ?? chunk.__perf.usage?.outputTokens ?? last.usage?.output ?? 0;
                const contextWindow =
                  chunk.__perf.usage?.contextWindow ?? last.contextWindow;
                const nextModel =
                  chunk.__perf.model && chunk.__perf.model !== "gateway-injected"
                    ? chunk.__perf.model
                    : last.model;
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    usage: { input, output },
                    model: nextModel,
                    contextWindow,
                    contextPercent:
                      contextWindow && input > 0
                        ? Math.min(Math.round((input / contextWindow) * 100), 100)
                        : last.contextPercent,
                  },
                ];
              });
              continue;
            }
            if (currentEvent === "tool_call") {
              const toolName = String(chunk.name || "unknown");
              const toolTs = Date.now();
              const isGateway = Boolean(chunk._gateway);
              // Gateway 内部工具：内联到消息卡片，不设顶部横幅
              if (isGateway) {
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: "{}", status: "running" as const, ts: toolTs, _gateway: true, executor: "gateway" }] };
                  }
                  return next;
                });
              } else {
                // exec 等服务端工具：设横幅 + 插卡片
                setActiveToolName(toolName);
                setActiveToolStartMs(toolTs);
                setActiveToolElapsed(0);
                setActiveToolStep(null);
                setActiveToolTotal(null);
                setActiveToolLabel(null);
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: String(chunk.arguments || ""), status: "running" as const, ts: toolTs }] };
                  }
                  return next;
                });
              }
              currentEvent = "";
              continue;
            }
            if (currentEvent === "tool_result") {
              const toolCallId = String(chunk.tool_call_id || "");
              const result = String(chunk.result ?? "");
              const isTimeout = chunk.policyDenyReason === "tool_timeout";
              const isGateway = Boolean(chunk._gateway);
              const status = chunk.is_error ? "error" : "done";
              const executor = chunk.executor as ("sandbox" | "native" | "none" | "timeout" | "gateway") | undefined;
              const truncated = Boolean(chunk.truncated);
              const suppressedOriginalResult = Boolean(chunk.suppressedOriginalResult);
              const policyDenyReason = chunk.policyDenyReason as string | undefined;
              const auditId = chunk.auditId as string | undefined;
              const outputFiles = Array.isArray(chunk.outputFiles) ? chunk.outputFiles as Array<{ name: string; size: number }> : undefined;
              // Gateway 内部工具完成：更新内联卡片状态
              if (isGateway) {
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const tcs = next[lastIdx].toolCalls || [];
                    // 找到最后一个 gateway running 的卡片
                    const gwIdx = tcs.findLastIndex((tc) => tc._gateway && tc.status === "running");
                    if (gwIdx >= 0) {
                      const updated = [...tcs];
                      updated[gwIdx] = { ...updated[gwIdx], status: "done", durationMs: Date.now() - updated[gwIdx].ts };
                      next[lastIdx] = { ...next[lastIdx], toolCalls: updated };
                    }
                  }
                  return next;
                });
                currentEvent = "";
                continue;
              }
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                const lastIdx = next.length - 1;
                if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                  const tcs = next[lastIdx].toolCalls || [];
                  next[lastIdx] = { ...next[lastIdx], toolCalls: tcs.map((tc) => tc.id === toolCallId ? { ...tc, result, status, durationMs: Date.now() - tc.ts, executor, truncated, suppressedOriginalResult, policyDenyReason, auditId, outputFiles, adoptId: resolvedAdoptId ?? undefined } : tc) as import("@/components/ChatMessage").ToolCallEntry[] };
                }
                return next;
              });
              // 超时时显示警告 3 秒后自动消失；普通完成后立即清除
              if (isTimeout) {
                setActiveToolName(`⏱️ 超时已中断（${Math.round((Date.now() - (activeToolStartMs ?? Date.now())) / 1000)}秒）`);
                setTimeout(() => { setActiveToolName(null); setActiveToolStartMs(null); setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null); }, 3000);
              } else {
                setActiveToolName(null);
                setActiveToolStartMs(null);
                setActiveToolStep(null);
                setActiveToolTotal(null);
                setActiveToolLabel(null);
              }
              currentEvent = "";
              continue;
            }
            if (currentEvent === "workspace_files") {
              // 技能产出文件（workspace/output/）-> 下载卡片
              const wsFiles = Array.isArray(chunk.files) ? chunk.files as Array<{ name: string; size: number; path: string }> : [];
              const wsAdoptId = String(chunk.adoptId || "");
              if (wsFiles.length > 0) {
                const pseudoTc: import("@/components/ChatMessage").ToolCallEntry = {
                  id: `ws-files-${Date.now()}`,
                  name: "[产出文件]",
                  arguments: "{}",
                  result: wsFiles.map((f) => f.name).join(", "),
                  status: "done",
                  ts: Date.now(),
                  executor: "native",
                  outputFiles: wsFiles.map((f) => ({ name: f.name, size: f.size, wsPath: f.path })) as any,
                  adoptId: wsAdoptId,
                };
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, pseudoTc] };
                  }
                  return next;
                });
              }
              currentEvent = "";
              continue;
            }
            // ── 统一语义：流结束 ──
            if (chunk.__stream_end) {
              console.log("[DIAG] ✅ 收到 __stream_end，流结束");
              flushDelta();
              sseDone = true;
              break;
            }
            // ── 2026-04-29 批次 2 A3：上游 EOF 但 runtime 未确认完成 ──
            if (chunk.__stream_truncated) {
              console.log("[DIAG] ⚠️ 收到 __stream_truncated，启动 recover:", chunk);
              flushDelta();
              handleStreamTruncated(chunk, lingxiaMsgsRef.current, setLingxiaMsgs);
              sseDone = true;
              break;
            }
            // ── 长度上限达到（finish_reason: length）──
            if (chunk.__stream_end_length) {
              console.log("[DIAG] ⚠️ 收到 __stream_end_length");
              flushDelta();
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
                next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + "\n\n_⚠️ 已达模型长度上限，输出可能不完整_" };
                return next;
              });
              sseDone = true;
              break;
            }
            // ── 统一语义：终止性错误 ──
            if (chunk.__stream_error) {
              console.log("[DIAG] ❌ 收到 __stream_error:", chunk.error);
              flushDelta();
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
                next[next.length - 1] = { ...next[next.length - 1], text: `（${chunk.error || "连接异常"}）` };
                return next;
              });
              sseDone = true;
              break;
            }
            if (chunk.error) {
              flushDelta();
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
                next[next.length - 1] = { ...next[next.length - 1], text: `（${chunk.error}）` };
                return next;
              });
              continue;
            }
            // reasoning_content delta（DeepSeek 等 reasoning 模型）→ 虚拟 thinking toolCall
            const httpReasoningDelta = chunk?.choices?.[0]?.delta?.reasoning_content;
            if (typeof httpReasoningDelta === "string" && httpReasoningDelta) {
              setLingxiaMsgs((prev) => applyReasoningDelta(prev, httpReasoningDelta));
            }
            const deltaRaw = chunk?.choices?.[0]?.delta?.content;
            // content 有时是对象数组（MiniMax/GLM 等模型），需提取文本
            const delta = Array.isArray(deltaRaw)
              ? deltaRaw.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
              : (typeof deltaRaw === "string" ? deltaRaw : (deltaRaw != null ? String(deltaRaw) : ""));
            if (delta) {
              // 收到 content delta → reasoning 阶段结束，mark thinking done
              setLingxiaMsgs((prev) => markThinkingDone(prev));
              pendingDelta += delta;
              scheduleFlush();
            }
            // HTTP 路径 finish_reason=stop 兜底 mark thinking done
            if (chunk?.choices?.[0]?.finish_reason === "stop") {
              setLingxiaMsgs((prev) => markThinkingDone(prev));
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }

      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushDelta();

      perf.clientDoneMs = Date.now();
      const toDur = (a?: number, b?: number) => (a && b ? Math.max(0, b - a) : null);
      // 工作台最小埋点：用于定位慢在模型/后端首包/前端首刷
      console.table({
        totalMs: toDur(perf.clientSendMs, perf.clientDoneMs),
        clientToServerEnterMs: toDur(perf.clientSendMs, perf.routeEnterMs),
        serverEnterToGatewayReqMs: toDur(perf.routeEnterMs, perf.gatewayRequestStartMs),
        gatewayReqToFirstUpstreamChunkMs: toDur(perf.gatewayRequestStartMs, perf.upstreamFirstChunkMs),
        firstUpstreamChunkToFirstPaintMs: toDur(perf.upstreamFirstChunkMs, perf.firstPaintMs),
        firstPaintToDoneMs: toDur(perf.firstPaintMs, perf.clientDoneMs),
      });
    } catch (error: any) {
      // SSE race fix: stale 流的 AbortError / 网络错误都不要写 state，否则会污染新流
      if (isStale()) return;
      if (error?.name === "AbortError") {
        setLingxiaMsgs((prev) => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1].role === "assistant" && next[next.length - 1].text === "") {
            next[next.length - 1] = { ...next[next.length - 1], text: "（已停止生成）" };
          }
          return next;
        });
        return;
      }
      // 网络错误 / fetch 失败 → 进入"重连中"状态，不直接判任务失败
      setConnStatus("reconnecting");
      setLingxiaMsgs((prev) => {
        const next = [...prev];
        const msg = error?.message || "实时连接中断，正在尝试恢复…";
        if (next.length > 0 && next[next.length - 1].role === "assistant" && next[next.length - 1].text === "") {
          next[next.length - 1] = { ...next[next.length - 1], text: msg };
        } else {
          next.push({ id: makeLxMsgId(), role: "assistant", text: msg, timeLabel: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) });
        }
        return next;
      });
    } finally {
      // SSE race fix: stale 流不要清 abortRef / streaming / activeTool，否则会误杀新流
      if (!isStale()) {
        lingxiaStreamAbortRef.current = null;
        if (!wsOk) setLingxiaStreaming(false);
        setConnStatus("connected");
        setActiveToolName(null);
        setActiveToolStartMs(null);
        setActiveToolStep(null);
        setActiveToolTotal(null);
        setActiveToolLabel(null);
      }
    }
  };


  const resetLingxiaSession = async () => {
    if (!resolvedAdoptId || activeLingxiaStreaming) return;
    const ok = await confirm({
      title: "重置会话？",
      description: "确认重置会话？将清空当前会话上下文。",
      confirmText: "重置",
      variant: "danger",
    });
    if (!ok) return;

    try {
      if (!chatV2Enabled) setLingxiaStreaming(true);
      const apiBase = import.meta.env.VITE_API_URL || "";
      const resp = await fetch(`${apiBase}/api/claw/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adoptId: resolvedAdoptId, message: "/reset", channel: "web", conversationId: webConversationId }),
      });

      if (!resp.ok) throw new Error(`重置失败 (${resp.status})`);
      if (chatV2Enabled) {
        chatV2.clear();
      } else {
        setLingxiaMsgs([]);
      }
      localStorage.removeItem("lingxia-chat-history");
      if (MSGS_KEY) localStorage.removeItem(MSGS_KEY);
      // 不需要断 WS：后端已通过 OpenClaw 原生 sessions.reset 换了 sessionId，
      // session key 不变，现有 WS 连接继续用即可，下次发消息打到新 sessionId 上
      toast.success("会话已重置（新会话）");
    } catch (error: any) {
      toast.error(error?.message || "重置会话失败");
    } finally {
      if (!chatV2Enabled) setLingxiaStreaming(false);
    }
  };

  const saveLingxiaSettings = async () => {
    if (!resolvedAdoptId || !user) {
      toast.error("请先登录后再保存设置");
      return;
    }
    await updateClawSettingsMutation.mutateAsync({
      adoptId: resolvedAdoptId,
      memoryEnabled: lingxiaMemoryEnabled,
      contextTurns: lingxiaContextTurns,
    });
  };

  useEffect(() => {
    if (!isLingxiaSubdomain) return;

    const versionTimer = window.setTimeout(() => {
      fetch("/api/meta/openclaw-version")
        .then(r => r.json())
        .then(d => {
          const v = (d?.version || "").toString().trim();
          if (v) setOpenclawVersion(v);
        })
        .catch(() => {});
    }, 1200);

    let runtimeTimer: number | null = null;
    if (resolvedAdoptId) {
      runtimeTimer = window.setTimeout(() => {
        fetch(`/api/claw/runtime-info?adoptId=${encodeURIComponent(resolvedAdoptId)}`)
          .then(r => r.json())
          .then(d => setRuntimeAgentId(String(d?.runtimeAgentId || "")))
          .catch(() => setRuntimeAgentId(""));
      }, 1600);
    }

    return () => {
      clearTimeout(versionTimer);
      if (runtimeTimer !== null) clearTimeout(runtimeTimer);
    };
  }, [isLingxiaSubdomain, resolvedAdoptId]);

  // 员工智能体聊天消息区：仅在接近底部时自动跟随
  const lingxiaMsgsEndRef = useRef<HTMLDivElement>(null);
  const isLingxiaNearBottom = () => {
    const el = lingxiaMsgViewportRef.current;
    if (!el) return true;
    const threshold = 100;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };
  const scrollLingxiaToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = lingxiaMsgViewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };
  useEffect(() => {
    if (lingxiaNearBottom) {
      scrollLingxiaToBottom(activeLingxiaStreaming ? "auto" : "smooth");
    }
  }, [activeLingxiaMsgs, activeLingxiaStreaming, lingxiaNearBottom]);

  // 技能行子组件
  // 技能行组件（内联，避免 Hook 规则问题）
  const SkillRow = ({ sk, onToggle, pending }: { sk: { id: string; emoji: string; label: string; desc: string; active: boolean }; onToggle: () => void; pending: boolean }) => (
    <div className="flex items-center px-4 py-2 gap-2">
      <span style={{ fontSize: 14 }}>{sk.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: sk.active ? "var(--oc-text-primary)" : "#70788e" }}>{sk.label}</p>
        <p className="text-xs truncate" style={{ color: "var(--oc-text-tertiary)" }}>{sk.desc}</p>
      </div>
      <button onClick={onToggle} disabled={pending}
        className="shrink-0 relative rounded-full transition-colors"
        style={{ width: 30, height: 16, background: sk.active ? "#9e1822" : "rgba(255,255,255,0.08)", border: "none", cursor: "pointer", flexShrink: 0 }}>
        <span className="absolute top-[2px] rounded-full transition-all"
          style={{ width: 12, height: 12, background: "#fff", left: sk.active ? 16 : 2, opacity: sk.active ? 1 : 0.4 }} />
      </button>
    </div>
  );

  const lingxiaExpiryInfo = useMemo(() => ({ text: "长期持有", color: "var(--oc-success)" }), []);

  const navLabel = (key: string) => LINGXIA_SIDEBAR_NAV.find((i) => i.key === key)?.label || key;
  const NavIcon = ({ navKey }: { navKey: keyof typeof sidebarIconMap }) => {
    const Cmp = sidebarIconMap[navKey];
    return <Cmp size={14} className="sidebar-item-icon" style={{ color: "var(--oc-text-secondary)" }} />;
  };
  if (isLingxiaSubdomain) {
    return (
      <>
      {dialog}
      <div className="h-screen overflow-hidden flex flex-col lingxia-shell" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>

        {/* 智能体广场抽屉（动效在 CollabDrawer 内部实现） */}
        {collabOpen && <CollabDrawer onClose={() => setCollabOpen(false)} adoptId={resolvedAdoptId || ""} />}

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 flex overflow-hidden">

          {/* ── 左侧：折叠面板，对齐 OpenClaw sidebar ── */}
          <aside className="relative flex-none flex flex-col overflow-hidden shrink-0 hide-all-scrollbars" style={{ width: sidebarCollapsed ? 72 : sidebarWidth, background: "var(--oc-panel)", borderRight: "1px solid var(--border)", transition: "width 0.2s ease" }}>
            <button
              type="button"
              title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
              onClick={() => setSidebarCollapsed(v => !v)}
              className="absolute right-2 top-2 z-40 w-6 h-6 rounded-md text-xs"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>

            {/* 实例信息头 */}
            <div className="px-4 py-3 shrink-0 flex items-center gap-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai"><BrandIcon size={26} animate={true} /></div>
              <div className="min-w-0" style={{ display: sidebarCollapsed ? "none" : "block" }}>
                <p className="text-sm font-medium truncate" style={{ color: "var(--oc-text-primary)" }}>{lingxiaDisplayName || brand.name}</p>
                <p className="text-[11px] font-mono truncate" style={{ color: "var(--oc-text-tertiary)" }} title={resolvedAdoptId}>{resolvedAdoptId}</p>
                {clawByAdoptId && (
                  <p className="text-[11px] flex items-center gap-1" style={{ color: clawByAdoptId.status === "active" ? "#34d399" : "#fbbf24" }}>
                    <span className={clawByAdoptId.status === "active" ? "animate-pulse" : ""}>●</span>
                    <span>{clawByAdoptId.status === "active" ? "在线" : clawByAdoptId.status}</span>
                  </p>
                )}
              </div>
            </div>

            {/* 工作台导航（Phase A） */}
            <Sidebar
              activePage={activePage}
              setActivePage={setActivePage}
              collapsed={sidebarCollapsed}
              coopBadge={coopBadgeCount}
            />

            {/* 旧侧栏能力暂留（Phase B 迁移），当前隐藏 */}
                        <SidebarFooter
              version={isHermesRuntime ? "Hermes v0.10.0" : openclawVersion}
              expiryText={lingxiaExpiryInfo.text}
              expiryColor={lingxiaExpiryInfo.color}
              collapsed={sidebarCollapsed}
              onDocsClick={() => setActivePage("docs")}
            />

            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const onMove = (ev: MouseEvent) => {
                  const w = Math.min(Math.max(ev.clientX, 220), 520);
                  setSidebarWidth(w);
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-30 border-l border-dashed border-transparent hover:border-primary/30 hover:bg-white/5 transition-colors"
              style={{ display: sidebarCollapsed ? "none" : "block" }}
            />
          </aside>


          {/* ── 右侧主面板 ── */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* 全局顶部栏 */}
          <TopBar
            activePage={activePage}
            center={activePage === "chat" ? (
              <>
                <Select value={lingxiaModelId} onValueChange={(v) => {
                  setLingxiaModelId(v);
                  if (!user) { toast.error("请先登录"); return; }
                  switchModelMutation.mutate({ adoptId: resolvedAdoptId!, modelId: v });
                }}>
                  <SelectTrigger
                    size="sm"
                    className="focus:ring-0 focus:ring-offset-0"
                    style={{
                      height: 30,
                      paddingLeft: 12,
                      paddingRight: 10,
                      background: "var(--oc-bg-active)",
                      border: "1px solid var(--oc-border)",
                      color: "var(--oc-text-primary)",
                      fontSize: "var(--oc-text-sm)",
                      fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Consolas", ui-monospace, monospace',
                      fontWeight: "var(--oc-weight-medium)",
                      borderRadius: "var(--oc-radius-md)",
                      minWidth: 220,
                    }}
                  >
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      background: "var(--oc-bg)",
                      border: "1px solid var(--oc-border)",
                      borderRadius: 10,
                      minWidth: 300,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                      padding: "4px",
                    }}
                  >
                    {(availableModels || []).map((m: any) => {
                      const modelName = String(m.name || "").trim() || formatModelName(m.id);
                      const provider = getModelProviderLabel(m.id);
                      return (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          className="lingxia-model-item"
                          style={{
                            fontSize: "var(--oc-text-sm)",
                            fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Consolas", ui-monospace, monospace',
                            fontWeight: "var(--oc-weight-medium)",
                            borderRadius: 6,
                            padding: "7px 10px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {m.isDefault && (
                              <span style={{ color: "var(--oc-accent)", fontSize: "var(--oc-text-2xs)", flexShrink: 0 }}>★</span>
                            )}
                            <span style={{ color: "var(--oc-text-primary)" }}>{modelName}</span>
                            {provider && (
                              <span style={{ color: "var(--oc-text-secondary)", fontSize: "var(--oc-text-xs)", opacity: 0.6 }}>
                                · {provider}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <button
                  onClick={resetLingxiaSession}
                  disabled={activeLingxiaStreaming}
                  className="lingxia-topbar-btn"
                  style={{ height: 30, padding: "0 12px", borderRadius: "var(--oc-radius-md)", fontSize: "var(--oc-text-sm)", whiteSpace: "nowrap" }}
                >
                  重置会话
                </button>
              </>
            ) : undefined}
            right={activePage === "chat" ? (
              <button
                onClick={() => {
                  setCollabOpen(true);
                }}
                className={`lingxia-topbar-btn ${collabOpen ? "is-active" : ""}`}
                style={{ height: 30, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, borderRadius: "var(--oc-radius-md)", fontSize: "var(--oc-text-sm)", whiteSpace: "nowrap" }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                智能体广场
              </button>
            ) : undefined}
          />

          {activePage === "chat" ? (
          <ChatPage>
          <main className="relative flex-1 min-w-0 flex flex-col overflow-hidden">

            {/* 消息区 */}
            <div
              ref={lingxiaMsgViewportRef}
              onScroll={() => setLingxiaNearBottom(isLingxiaNearBottom())}
              className="flex-1 min-h-0 overflow-y-auto pt-6 px-6 space-y-5 stealth-scrollbar" style={{ paddingBottom: 100 }}
            >


              {clawByAdoptLoading && <p className="text-sm" style={{ color: "var(--oc-text-tertiary)" }}>加载中…</p>}

              {!clawByAdoptLoading && !clawByAdoptId && (
                <div className="max-w-4xl rounded-xl p-4 text-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", color: "#d4a030" }}>
                  未找到该员工智能体实例，可能已过期或尚未完成创建。
                </div>
              )}

              {!clawByAdoptLoading && clawByAdoptId && activeLingxiaMsgs.length === 0 && (
                /* 欢迎消息：带头像，对齐 OpenClaw AI 消息风格 */
                <div className="flex items-start gap-3 max-w-4xl lingxia-msg-fade">
                  <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} animate={false} /></div>
                  <div>
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: "color-mix(in oklab, var(--oc-card) 65%, transparent)", color: "var(--oc-text-primary)" }}>
                      你好，我是 <span style={{ color: "var(--oc-accent, #7c3aed)", fontWeight: "var(--oc-weight-semibold)" }}>{lingxiaDisplayName || brand.name}</span>，有什么想聊的？
                    </div>
                    <p className="text-[10px] mt-1 px-1 font-mono" style={{ color: "var(--oc-text-tertiary)" }}>{lingxiaDisplayName || brand.name} · {formatModelName(lingxiaModelId)}</p>
                  </div>
                </div>
              )}

              {agentTasks.length > 0 && (
                <div style={{ margin: "8px 0" }}>
                  {agentTasks.map((t) => <AgentTaskCard key={t.id} task={t} />)}
                </div>
              )}
              {activeLingxiaMsgs.map((m, idx) => {
                const isLast = idx === activeLingxiaMsgs.length - 1;
                const isPlaceholder = isLast && m.role === "assistant" && m.text === "" && activeLingxiaStreaming;
                return (
                  <div key={idx}>
                  <ChatMessage
                    role={m.role as "user" | "assistant"}
                    text={m.text}
                    isLast={isLast}
                    isPlaceholder={isPlaceholder}
                    streaming={activeLingxiaStreaming}
                    displayName={lingxiaDisplayName || brand.name}
                    modelId={lingxiaModelId || "default"}
                    timeLabel={m.timeLabel}
                    toolCalls={m.role === "assistant" ? (m.toolCalls ?? (isLast && !chatV2Enabled && lingxiaStreaming ? lingxiaToolCalls : [])) : undefined}
                    showToolCalls={lingxiaShowToolCalls}
                    usage={m.usage}
                    contextPercent={m.contextPercent}
                    onDelete={m.role === "assistant" && !chatV2Enabled ? () => { setLingxiaMsgs(prev => prev.filter((_, i) => i !== idx)); } : undefined}
                  />
                  </div>
                );
              })}

              <div ref={lingxiaMsgsEndRef} />
            </div>

            {!lingxiaNearBottom && (
              <div className="pointer-events-none absolute right-8 bottom-24 z-20">
                <button
                  className="pointer-events-auto text-xs px-3 py-1.5 rounded-full shadow-md"
                  style={{ background: "var(--oc-bg-surface)", border: "1px solid var(--oc-border-strong)", color: "var(--oc-text-primary)" }}
                  onClick={() => { setLingxiaNearBottom(true); scrollLingxiaToBottom("smooth"); }}
                >
                  回到底部
                </button>
              </div>
            )}

            {/* 输入区 */}
            <ChatInput
              value={lingxiaInput}
              onChange={setLingxiaInput}
              onSend={async (files = []) => {
                const text = (lingxiaInput || "").trim();
                if (!text && files.length === 0) return false;
                let finalText = text;
                if (files.length > 0) {
                  try {
                    const uploaded = await uploadLingxiaAttachments(files);
                    finalText = buildMessageWithUploadedAttachments(text, uploaded);
                    toast.success(`已上传 ${uploaded.length} 个附件`);
                  } catch (error: any) {
                    toast.error(error?.message || "附件上传失败");
                    return false;
                  }
                }
                if (chatV2Enabled) {
                  if (!finalText.trim() || chatV2.isStreaming) return false;
                  setMentionedUsers([]);
                  setLingxiaInput("");
                  setLingxiaNearBottom(true);
                  await chatV2.send(finalText);
                  return true;
                }
                // 重扫 text 里实际还有的 @userName，过滤掉用户已删除的 mention（防 mentionedUsers 状态 ghost）
                // 既有限制：textarea 是 plain text，不是 chip，删除标签靠这里 reconcile 兜底
                const liveMentions = mentionedUsers.filter((u) => text.includes(`@${u.userName}`));
                if (liveMentions.length === 0) {
                  // 没 @ 任何人 → 普通消息
                  if (mentionedUsers.length > 0) setMentionedUsers([]);
                  await sendLingxiaMessage(finalText);
                  return true;
                }
                if (!text) { toast.error("请先输入任务内容再发起协作"); return; }
                if (liveMentions.length === 1) {
	                  // 1:1 协作 → 直接 coop.create，跳 /coop/:sessionId（保持原行为）
	                  coopCreateFromChatMut.mutate({
	                    title: text.slice(0, 80).split(/\n/)[0] || "主聊天发起的协作",
	                    originMessage: finalText,
	                    creatorAdoptId: resolvedAdoptId || "lgc-creator",
	                    members: liveMentions.map((u) => ({
	                      userId: u.userId,
	                      targetAdoptId: u.adoptId || `mock:${u.userId}`,
	                      subtask: finalText,
	                    })),
	                  });
	                  return true;
	                }
                // ≥2 人 → 跳 /coop/new 让用户给每人分子任务（飞书+Linear 模式）
                try {
	                  sessionStorage.setItem("coop_prefill", JSON.stringify({
	                    origin: finalText,
	                    title: text.slice(0, 80).split(/\n/)[0],
                    members: liveMentions.map((u) => ({ userId: u.userId, userName: u.userName, adoptId: u.adoptId })),
                  }));
                } catch {}
	                setMentionedUsers([]);
	                setLingxiaInput("");
	                setLocationCoop("/coop/new");
	                return true;
	              }}
              onStop={chatV2Enabled ? () => chatV2.abort("home_stop") : stopLingxiaStreaming}
              streaming={activeLingxiaStreaming}
              disabled={false}
              placeholder={`Message ${lingxiaDisplayName || brand.name}…`}
              maxLength={4000}
              messages={activeLingxiaMsgs as any}
              onNewChat={resetLingxiaSession}
              onUserMention={(u) => {
                setMentionedUsers((prev) => prev.some((x) => x.userId === u.userId) ? prev : [...prev, u]);
              }}
            />

          </main>
          </ChatPage>
          ) : (
            <MainPanel
              activePage={activePage as Exclude<PageKey, "chat">}
              adoptId={resolvedAdoptId || ""}
              skills={{
                data: lingxiaSkills as any,
                canEdit: !!user,
                pending: toggleSkillMutation.isPending,
                onToggle: (skillId, enable, source) => {
                  if (!user) { toast.error("请先登录"); return; }
                  toggleSkillMutation.mutate({ adoptId: resolvedAdoptId!, skillId, enable, source });
                },
              }}
            />
          )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // Linggan homepage code removed — this route always resolves to lingxia console
  return null;

}
