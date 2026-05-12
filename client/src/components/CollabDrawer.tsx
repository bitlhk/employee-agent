import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAgentState, sendBusinessMessage, stopBusinessMessage, clearAgentState } from "@/lib/businessChatStore";
import { CodeAgentView } from "./code-agent/CodeAgentView";
import { X, ChevronLeft, Download, Zap, Bot, Loader2, Send, Square, Users, Clock, Plus, Presentation, Code2, TrendingUp, Dna, Mic, MicOff, BarChart3, Battery, Compass, Maximize2, FolderOpen, Trash2, Search, FileText, Globe2 } from "lucide-react";
import { SlidePreviewModal } from "@/components/pages/SlidePreviewModal";
import { createPortal } from "react-dom";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// ── 类型 ─────────────────────────────────────────────────────────────────
interface AgentExample { text: string; icon?: string; }
interface AgentUiConfig {
  category?: string;
  template?: string;
  subtitle?: string;
  welcomeTitle?: string;
  welcomeDescription?: string;
  examples?: AgentExample[];
  badges?: string[];
}
interface BusinessAgent {
  id: string;
  name: string;
  description: string;
  sandboxScope: string;
  model: string;
  icon?: string;
  tags?: string;
  uiConfig?: AgentUiConfig;
}
interface HermesToolCall { id: string; name: string; preview: string; status: "running" | "done" | "error"; durationMs?: number; ts: number; }
interface TaskMessage { role: "user" | "assistant"; text: string; status?: string; toolCalls?: HermesToolCall[]; reasoning?: string; }
interface TaskFile { name: string; size: number; updatedAt: string; }
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const TASK_TYPE_LABELS: Record<string, string> = {
  data_analysis: "数据分析", contract_review: "合同审阅",
  research: "研究调查", report: "报告生成", general: "通用协作",
};

import { LingxiaIcon } from "@/components/LingxiaIcon";

// ── 引擎图标映射（只有用外部引擎的才显示动画）────────────────────────
const ENGINE_ICON: Record<string, string> = {
  "task-code":   "/uploads/claudecode.png",
  "task-slides": "/uploads/claudecode.png",
};

function agentIcon(id: string, size = 16) {
  const style = { color: "var(--oc-accent)" };
  if (id === "task-ppt") return <Presentation size={size} style={style} />;
  if (id === "task-code") return <Code2 size={size} style={style} />;
  if (id === "task-hermes") return <Dna size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-trace") return <Bot size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-stock") return <BarChart3 size={size} style={{ color: "var(--oc-danger)" }} />;
  if (id === "task-claim-ev") return <Battery size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-my-wealth") return <TrendingUp size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-bond") return <BarChart3 size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-credit-risk") return <Compass size={size} style={{ color: "#be1e2d" }} />;
  return <Bot size={size} style={style} />;
}

function configuredIcon(icon?: string | null, size = 16) {
  const key = String(icon || "").trim().toLowerCase();
  const style = { color: "var(--oc-accent)" };
  if (key === "search") return <Search size={size} style={style} />;
  if (key === "filetext" || key === "file-text") return <FileText size={size} style={style} />;
  if (key === "globe" || key === "globe2") return <Globe2 size={size} style={style} />;
  if (key === "bot") return <Bot size={size} style={style} />;
  if (icon && icon.trim().length <= 4 && !icon.trim().startsWith("/")) {
    return <span style={{ fontSize: size + 2, lineHeight: 1 }}>{icon.trim()}</span>;
  }
  return null;
}

const LEGACY_AGENT_CATEGORY: Record<string, string> = {
  "task-hermes": "core",
  "task-trace": "core",
  "task-ppt": "tools",
  "task-code": "tools",
  "task-slides": "tools",
  "task-stock": "finance",
  "task-claim-ev": "finance",
  "task-my-wealth": "finance",
  "task-bond": "finance",
  "task-credit-risk": "finance",
};

const LEGACY_AGENT_SUBTITLE: Record<string, string> = {
  "task-hermes": "灵枢 · 共享空间",
  "task-trace": "灵枢 · 深度求索",
  "task-stock": "灵犀 · 11策略",
  "task-claim-ev": "灵犀 · EV 理赔决策",
  "task-my-wealth": "灵犀 · 个人理财",
  "task-bond": "灵犀 · 债券投研",
  "task-credit-risk": "灵犀 · 智贷决策",
};

const PLAZA_GROUPS = [
  {
    id: "core",
    title: "灵枢 · 核心引擎",
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#be1e2d" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>,
  },
  { id: "tools", title: "灵匠 · 创作工具", icon: <Code2 size={12} /> },
  { id: "finance", title: "灵犀 · 分析研判", icon: <TrendingUp size={12} /> },
  { id: "other", title: "其他", icon: <Bot size={12} /> },
] as const;

const LEGACY_TEMPLATE_MAP: Record<string, string> = {
  general: "general_chat",
  finance: "research_analysis",
  tool: "artifact_generation",
  compact: "general_chat",
};

const AGENT_TEMPLATE_META: Record<string, { label: string; examplesTitle: string; hint: string; accent: string; defaultBadges: string[] }> = {
  general_chat: {
    label: "通用对话",
    examplesTitle: "试试问我",
    hint: "支持多轮对话 · 30分钟无操作自动终止",
    accent: "var(--oc-accent)",
    defaultBadges: ["对话", "工具", "会话"],
  },
  research_analysis: {
    label: "研究分析",
    examplesTitle: "分析入口",
    hint: "适合投研、搜索、数据分析类任务",
    accent: "#be1e2d",
    defaultBadges: ["研判", "数据", "工具"],
  },
  artifact_generation: {
    label: "产物生成",
    examplesTitle: "生成入口",
    hint: "适合报告、PPT、代码和文件产物生成",
    accent: "#c7000b",
    defaultBadges: ["产物", "文件", "预览"],
  },
  workflow_decision: {
    label: "专业流程",
    examplesTitle: "流程入口",
    hint: "适合多阶段决策、审核和合规任务",
    accent: "#be1e2d",
    defaultBadges: ["流程", "审慎", "审计"],
  },
};

function normalizeUiTemplate(value?: string | null) {
  const raw = String(value || "").trim();
  const normalized = LEGACY_TEMPLATE_MAP[raw] || raw;
  return AGENT_TEMPLATE_META[normalized] ? normalized : "";
}

function defaultUiTemplateFor(agent: BusinessAgent) {
  if (["task-ppt", "task-code", "task-slides"].includes(agent.id)) return "artifact_generation";
  if (["task-stock", "task-bond", "task-my-wealth"].includes(agent.id)) return "research_analysis";
  if (["task-credit-risk", "task-claim-ev"].includes(agent.id)) return "workflow_decision";
  return "general_chat";
}

function getAgentTemplate(agent: BusinessAgent) {
  const ui = agent.uiConfig || {};
  return normalizeUiTemplate(ui.template) || defaultUiTemplateFor(agent);
}

function normalizeUiConfig(agent: BusinessAgent): AgentUiConfig {
  const ui = agent.uiConfig || {};
  const template = normalizeUiTemplate(ui.template) || defaultUiTemplateFor(agent);
  return {
    ...ui,
    category: ui.category || LEGACY_AGENT_CATEGORY[agent.id] || "other",
    template,
    subtitle: ui.subtitle || LEGACY_AGENT_SUBTITLE[agent.id] || "per-session · 独立沙箱",
  };
}

function renderAgentIcon(agent: BusinessAgent, size = 16) {
  if (LEGACY_AGENT_CATEGORY[agent.id]) {
    return agentIcon(agent.id, size);
  }
  const icon = configuredIcon(agent.icon, size);
  if (icon) return icon;
  return agentIcon(agent.id, size);
}

function getAgentSubtitle(agent: BusinessAgent) {
  return normalizeUiConfig(agent).subtitle || "per-session · 独立沙箱";
}

function getAgentCardDescription(agent: BusinessAgent) {
  const ui = normalizeUiConfig(agent);
  return agentDesc(agent.id, ui.welcomeDescription || agent.description);
}

function getAgentPromptPlaceholder(agent: BusinessAgent) {
  const template = getAgentTemplate(agent);
  if (template === "research_analysis") return `向 ${agent.name} 发起分析...`;
  if (template === "artifact_generation") return `让 ${agent.name} 生成产物...`;
  if (template === "workflow_decision") return `向 ${agent.name} 发起流程任务...`;
  return `向 ${agent.name} 发起任务...`;
}

function ConfiguredAgentWelcome({ agent, onPickExample }: { agent: BusinessAgent; onPickExample: (text: string) => void }) {
  const ui = normalizeUiConfig(agent);
  const template = getAgentTemplate(agent);
  const templateMeta = AGENT_TEMPLATE_META[template] || AGENT_TEMPLATE_META.general_chat;
  const examples = Array.isArray(ui.examples) ? ui.examples.filter(e => e?.text) : [];
  const badges = Array.isArray(ui.badges) && ui.badges.length > 0 ? ui.badges.filter(Boolean) : templateMeta.defaultBadges;
  const accent = templateMeta.accent || (ui.category === "finance" ? "#be1e2d" : ui.category === "tools" ? "#c7000b" : "var(--oc-accent)");
  const useEngineAnimation = template === "artifact_generation" && !!ENGINE_ICON[agent.id];

  return (
    <>
      {useEngineAnimation ? (
        <AgentHeroAnimation agentId={agent.id} />
      ) : (
        <div className="flex items-center justify-center">{renderAgentIcon(agent, template === "workflow_decision" ? 46 : 40)}</div>
      )}
      <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>{ui.welcomeTitle || agent.name}</p>
      <p className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>
        {ui.welcomeDescription || agent.description || "业务智能体"}
      </p>
      <div className="mt-2 flex justify-center">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "color-mix(in oklab, var(--oc-accent) 7%, transparent)", color: accent, border: "1px solid color-mix(in oklab, var(--oc-accent) 18%, transparent)" }}>
          {templateMeta.label}
        </span>
      </div>
      {examples.length > 0 && (
        <div className="mt-4 mx-auto max-w-[280px] rounded-lg px-3 py-2.5 text-left" style={{ background: "color-mix(in oklab, var(--oc-accent) 5%, transparent)", border: "1px solid color-mix(in oklab, var(--oc-accent) 16%, transparent)" }}>
          <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>{templateMeta.examplesTitle}</p>
          {examples.map((item) => (
            <p key={item.text} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-start gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.72 }} onClick={() => onPickExample(item.text)}>
              {item.icon && <span className="shrink-0 pt-0.5">{configuredIcon(item.icon, 12)}</span>}
              <span>{item.text}</span>
            </p>
          ))}
        </div>
      )}
      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {badges.map((badge) => (
            <span key={badge} className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "color-mix(in oklab, var(--oc-accent) 8%, transparent)", color: accent, border: "1px solid color-mix(in oklab, var(--oc-accent) 18%, transparent)" }}>{badge}</span>
          ))}
        </div>
      )}
      <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.45 }}>{ui.subtitle || templateMeta.hint}</p>
    </>
  );
}

/** 聊天空状态动画：粒子流 — 小虾发射彩色圆点飘向引擎 icon */
function AgentHeroAnimation({ agentId }: { agentId: string }) {
  const engineSrc = ENGINE_ICON[agentId];
  if (!engineSrc) return null;

  // 引擎目标色
  const targetColor = "#d97754";
  // 5 个粒子，错开出发
  const dots = [0, 1, 2, 3, 4];

  return (
    <div className="hero-pf-wrap">
      <style>{`
        .hero-pf-wrap {
          position: relative; width: 200px; height: 72px; margin: 0 auto;
        }

        /* ── icon 容器（静止） ── */
        .hero-pf-icon {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 52px; height: 52px; border-radius: 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          display: flex; align-items: center; justify-content: center;
          z-index: 2;
        }
        .hero-pf-icon img { width: 34px; height: 34px; object-fit: contain; }
        .hero-pf-left  { left: 0; }
        .hero-pf-right { right: 0; }

        /* ── 粒子轨道区 ── */
        .hero-pf-track {
          position: absolute; top: 0; bottom: 0;
          left: 58px; right: 58px;
          pointer-events: none; overflow: hidden;
        }

        /* ── 单个粒子 ── */
        .hero-pf-dot {
          position: absolute;
          width: 5px; height: 5px; border-radius: 50%;
          top: 50%; left: -5px;
          opacity: 0;
          filter: blur(0.3px);
          animation: pf-fly 3s ease-in-out infinite;
        }

        /* 5 个粒子错开 + 颜色渐变 */
        .hero-pf-dot:nth-child(1) { animation-delay: 0s; }
        .hero-pf-dot:nth-child(2) { animation-delay: 0.55s; }
        .hero-pf-dot:nth-child(3) { animation-delay: 1.1s; }
        .hero-pf-dot:nth-child(4) { animation-delay: 1.65s; }
        .hero-pf-dot:nth-child(5) { animation-delay: 2.2s; }

        @keyframes hermes-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes pf-fly {
          0% {
            left: -5px;
            opacity: 0;
            transform: translateY(-50%) translateY(0px);
            background: #ff5a5f;
            box-shadow: 0 0 4px #ff5a5f;
          }
          8% {
            opacity: 0.9;
          }
          25% {
            transform: translateY(-50%) translateY(-8px);
            background: #e11d48;
          }
          50% {
            transform: translateY(-50%) translateY(6px);
            background: ${targetColor}88;
            box-shadow: 0 0 6px ${targetColor}66;
          }
          75% {
            transform: translateY(-50%) translateY(-5px);
            background: ${targetColor};
          }
          92% {
            opacity: 0.85;
          }
          100% {
            left: calc(100% + 2px);
            opacity: 0;
            transform: translateY(-50%) translateY(2px);
            background: ${targetColor};
            box-shadow: 0 0 8px ${targetColor};
          }
        }
      `}</style>

      {/* 左：灵虾 */}
      <div className="hero-pf-icon hero-pf-left">
        <LingxiaIcon size={34} animate={false} breathe={false} />
      </div>

      {/* 中：粒子流 */}
      <div className="hero-pf-track">
        {dots.map(i => <div key={i} className="hero-pf-dot" />)}
      </div>

      {/* 右：引擎 */}
      <div className="hero-pf-icon hero-pf-right">
        <img src={engineSrc} alt="engine" />
      </div>

    </div>
  );
}
function agentDesc(id: string, dbDescription?: string) {
  if (dbDescription) {
    const first = dbDescription.split("\n")[0];
    return first || dbDescription;
  }
  return "业务智能体";
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function statusColor(s: string) {
  if (s === "completed") return "#22c55e";
  if (s === "pending") return "#f59e0b";
  if (s === "approved" || s === "running") return "#60a5fa";
  if (s === "rejected" || s === "failed") return "#ef4444";
  return "var(--oc-text-secondary)";
}
function statusLabel(s: string) {
  const m: Record<string, string> = { pending: "待审批", approved: "已批准", running: "执行中", completed: "已完成", rejected: "已拒绝", failed: "失败" };
  return m[s] || s;
}

// ── 申请表单弹窗 ──────────────────────────────────────────────────────────
function RequestModal({ agent, requesterAdoptId, onClose, onSuccess }: { agent: any; requesterAdoptId: string; onClose: () => void; onSuccess: () => void; }) {
  const [taskType, setTaskType] = useState(agent.allowedTaskTypes?.[0] || "general");
  const [summary, setSummary] = useState("");
  const sendRequest = trpc.collab.sendRequest.useMutation({
    onSuccess: (data) => { toast.success(data.status === "approved" ? "已自动审批，执行中" : "申请已发出，等待审批"); onSuccess(); },
    onError: (e) => toast.error(e.message || "发起失败"),
  });
  const allowedTypes = agent.allowedTaskTypes?.length > 0 ? Object.entries(TASK_TYPE_LABELS).filter(([v]) => agent.allowedTaskTypes.includes(v)) : Object.entries(TASK_TYPE_LABELS);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 360, background: "var(--oc-bg)", borderRadius: "var(--oc-radius-lg)", border: "1px solid var(--oc-border)", padding: "20px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>向「{agent.displayName}」发起协作</div>
            <div className="text-[10px] mt-0.5" style={{ color: agent.acceptTask === "auto" ? "#22c55e" : "#f59e0b" }}>
              {agent.acceptTask === "auto" ? "自动通过通过" : "需对方审批"}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-80"><X size={14} style={{ color: "var(--oc-text-secondary)" }} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--oc-text-secondary)" }}>任务类型</label>
            <select value={taskType} onChange={e => setTaskType(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
              {allowedTypes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--oc-text-secondary)" }}>任务描述</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="描述你需要对方帮忙做什么（不要包含隐私数据）" rows={3} className="w-full text-xs rounded-lg px-3 py-2 resize-none focus:outline-none" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
          <div className="text-[10px] rounded-lg px-3 py-2" style={{ background: "var(--oc-input-bg)", color: "var(--oc-text-secondary)", border: "1px solid var(--oc-border)" }}>🔒 平台保证：对方无法访问你的聊天记录或私有记忆</div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 text-xs py-2 rounded-lg" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)", cursor: "pointer" }}>取消</button>
          <button onClick={() => sendRequest.mutate({ requesterAdoptId, targetAdoptId: agent.adoptId, taskType, taskSummary: summary })} disabled={!summary.trim() || sendRequest.isPending} className="flex-1 text-xs py-2 rounded-lg disabled:opacity-40" style={{ background: "var(--oc-accent)", color: "var(--oc-text-on-accent)", border: "none", cursor: "pointer" }}>
            {sendRequest.isPending ? "发送中..." : "发起申请"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 协作执行面板（批准后在这里看执行过程 + 选择怎么回复）─────────────────
function CollabExecPanel({ req, adoptId, onBack, onDone }: { req: any; adoptId: string; onBack: () => void; onDone: () => void; }) {
  const [streamText, setStreamText] = useState("");
  const [execDone, setExecDone] = useState(false);
  const [execStatus, setExecStatus] = useState(req.status);
  const [deliverMode, setDeliverMode] = useState<"full" | "summary" | "none">("full");
  const [customSummary, setCustomSummary] = useState("");
  const [resultText, setResultText] = useState(req.resultSummary || "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const apiBase = (import.meta as any).env?.VITE_API_URL || "";

  const meta = (() => { try { return req.resultEnvelope || {}; } catch { return {}; } })();
  const alreadyDelivered = !!meta.deliveredAt;
  const canDeliver = ["completed", "partial_success"].includes(execStatus) && !alreadyDelivered;

  const deliverResult = trpc.collab.deliverResult.useMutation({
    onSuccess: () => { toast.success("已发送给对方"); onDone(); },
    onError: (e) => toast.error(e.message || "发送失败"),
  });

  const reviewRequest = trpc.collab.reviewRequest.useMutation({
    onSuccess: () => {
      setExecStatus("approved");
      // 批准后立即开始接 SSE 流
      startStream();
    },
    onError: (e) => toast.error(e.message || "操作失败"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamText]);

  // 如果已经在 running/completed，直接接流或加载结果
  useEffect(() => {
    if (req.status === "running") startStream();
    if (["completed", "partial_success"].includes(req.status)) {
      setExecDone(true);
      setResultText(req.resultSummary || "");
      setCustomSummary((req.resultSummary || "").slice(0, 300));
    }
    return () => { esRef.current?.close(); };
  }, []);

  const startStream = () => {
    esRef.current?.close();
    const es = new EventSource(`${apiBase}/api/claw/collab-stream/${req.id}?_t=${Date.now()}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.done) {
          es.close();
          setExecDone(true);
          setExecStatus("completed");
          // 重新拉一次请求数据拿结果
          fetch(`${apiBase}/api/trpc/collab.incoming?input=${encodeURIComponent(JSON.stringify({ adoptId }))}`, { credentials: "include" })
            .then(r => r.json())
            .then(d => {
              const found = (d?.result?.data?.json || []).find((r: any) => r.id === req.id);
              if (found) { setResultText(found.resultSummary || ""); setCustomSummary((found.resultSummary || "").slice(0, 300)); }
            }).catch(() => {});
        } else if (d.chunk) {
          setStreamText(t => t + d.chunk);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); if (!execDone) setExecStatus("failed"); };
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "var(--oc-border)" }}>
        <button onClick={onBack} className="p-1 rounded hover:opacity-80 transition-colors"><ChevronLeft size={16} style={{ color: "var(--oc-text-secondary)" }} /></button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--oc-text-primary)" }}>{TASK_TYPE_LABELS[req.taskType] || req.taskType}</div>
          <div className="text-[10px]" style={{ color: "var(--oc-text-secondary)" }}>来自 {req.requesterDisplayName || req.requesterAdoptId}</div>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: statusColor(execStatus), border: `1px solid ${statusColor(execStatus)}44`, background: `${statusColor(execStatus)}11` }}>{statusLabel(execStatus)}</span>
      </div>

      {/* 任务内容 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {/* 原始任务 */}
        <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--oc-bg-hover)", border: "1px solid var(--oc-border)" }}>
          <p className="text-[10px] mb-1 font-semibold" style={{ color: "var(--oc-text-secondary)" }}>任务请求</p>
          <p className="text-sm" style={{ color: "var(--oc-text-primary)" }}>{req.taskSummary}</p>
        </div>

        {/* 待批准 */}
        {req.status === "pending" && execStatus === "pending" && (
          <div className="space-y-2">
            <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,.25)", color: "var(--oc-warning)" }}>
              批准后你的助手将自动处理这个任务
            </div>
            <div className="flex gap-2">
              <button onClick={() => reviewRequest.mutate({ adoptId, requestId: req.id, action: "reject" })} disabled={reviewRequest.isPending} className="flex-1 text-xs py-2.5 rounded-lg disabled:opacity-40" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,.3)", color: "var(--oc-danger)", cursor: "pointer" }}>拒绝</button>
              <button onClick={() => reviewRequest.mutate({ adoptId, requestId: req.id, action: "approve" })} disabled={reviewRequest.isPending} className="flex-1 text-xs py-2.5 rounded-lg disabled:opacity-40 font-medium" style={{ background: "var(--oc-accent)", border: "none", color: "var(--oc-text-on-accent)", cursor: "pointer" }}>{reviewRequest.isPending ? "处理中..." : "✅ 批准执行"}</button>
            </div>
          </div>
        )}

        {/* 执行中：流式输出 */}
        {(execStatus === "running" || execStatus === "approved") && !execDone && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={12} className="animate-spin" style={{ color: "var(--oc-info)" }} />
              <p className="text-[10px] font-semibold" style={{ color: "var(--oc-info)" }}>我的助手正在处理...</p>
            </div>
            {streamText ? (
              <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--oc-bg-hover)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)", whiteSpace: "pre-wrap" }}>
                <ChatMarkdown content={streamText} />
              </div>
            ) : (
              <div className="flex items-center gap-2 py-2">
                {[0, 0.2, 0.4].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--oc-text-secondary)", animationDelay: `${d}s` }} />)}
              </div>
            )}
          </div>
        )}

        {/* 执行完成 + 选择如何回复 */}
        {execDone && !alreadyDelivered && resultText && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>执行结果（仅你可见）</p>
              <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,.2)", color: "var(--oc-text-primary)", maxHeight: 140, overflowY: "auto" }}>
                <ChatMarkdown content={resultText} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>回复给对方：</p>
              <div className="space-y-1.5">
                {([["full", "发完整结果", "直接把上面的结果发给对方"], ["summary", "发自定义摘要", "你来编辑要发什么"], ["none", "🚫 不回复", "执行了但不告诉对方"]] as const).map(([val, label, desc]) => (
                  <label key={val} className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2 transition-all" style={{ background: deliverMode === val ? "rgba(255,255,255,0.06)" : "transparent", border: `1px solid ${deliverMode === val ? "var(--oc-border)" : "transparent"}` }}>
                    <input type="radio" name="dm" value={val} checked={deliverMode === val} onChange={() => { setDeliverMode(val); if (val === "summary") setCustomSummary(resultText.slice(0, 200)); }} className="mt-0.5 shrink-0" style={{ accentColor: "var(--oc-accent)" }} />
                    <div><div className="text-xs font-medium" style={{ color: "var(--oc-text-primary)" }}>{label}</div><div className="text-[10px]" style={{ color: "var(--oc-text-secondary)" }}>{desc}</div></div>
                  </label>
                ))}
              </div>
              {deliverMode === "summary" && (
                <textarea value={customSummary} onChange={e => setCustomSummary(e.target.value)} rows={3} className="w-full mt-2 text-xs rounded-lg px-3 py-2 resize-none focus:outline-none" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} placeholder="输入要发给对方的内容..." />
              )}
            </div>
          </div>
        )}

        {/* 已拒绝 */}
        {execStatus === "rejected" && (
          <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,.2)", color: "var(--oc-danger)" }}>已拒绝该请求</div>
        )}

        {/* 已交付完成 */}
        {alreadyDelivered && (
          <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,.2)", color: "var(--oc-success)" }}>
            已回复对方（{meta.deliverMode === "full" ? "完整结果" : meta.deliverMode === "summary" ? "摘要" : "不回复"}）
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 底部：发送按钮 */}
      {execDone && !alreadyDelivered && resultText && (
        <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "var(--oc-border)" }}>
          <button
            onClick={() => deliverResult.mutate({ adoptId, requestId: req.id, deliverMode, customSummary: deliverMode === "summary" ? customSummary : undefined })}
            disabled={deliverResult.isPending || (deliverMode === "summary" && !customSummary.trim())}
            className="w-full text-sm py-2.5 rounded-xl font-medium disabled:opacity-40 transition-all active:scale-[0.99]"
            style={{ background: "var(--oc-accent)", color: "var(--oc-text-on-accent)", border: "none", cursor: "pointer" }}
          >
            {deliverResult.isPending ? "发送中..." : deliverMode === "none" ? "确认不回复" : "确认发送"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 业务 Agent 任务面板 ───────────────────────────────────────────────────
function TaskPanel({ agent, onBack, prefillPrompt }: { agent: BusinessAgent; onBack: () => void; prefillPrompt?: string }) {
  const { confirm, dialog } = useConfirmDialog();
  // module-level store: state survives unmount, fetch keeps writing in background
  const { msgs, sessionKey, streaming } = useAgentState(agent.id);
  const [input, setInput] = useState("");

  // 消费从主聊天传来的预填 prompt（只在挂载时触发一次）
  useEffect(() => {
    if (prefillPrompt && prefillPrompt.trim()) {
      setInput(prefillPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [files, setFiles] = useState<TaskFile[]>([]);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      // Stop
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      return;
    }
    // Start
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 100) return;
        try {
          const res = await fetch(((import.meta as any).env?.VITE_API_URL || "") + "/api/claw/voice/transcribe", { method: "POST", headers: { "Content-Type": mimeType }, body: blob, credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            if (data.text) setInput(prev => prev + data.text);
          }
        } catch {}
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err: any) {
      alert("无法启动录音：" + (err.message || "请检查麦克风权限"));
    }
  }, [recording]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileHistoryOpen, setFileHistoryOpen] = useState(false);
  const [previewModalData, setPreviewModalData] = useState<{ previewUrl: string; downloadUrl: string; fileName: string } | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiBase = (import.meta as any).env?.VITE_API_URL || "";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const clearTimers = useCallback(() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); if (countdownRef.current) clearInterval(countdownRef.current); }, []);
  const startTimeout = useCallback(() => {
    clearTimers(); setSessionExpired(false); setCountdown(null);
    timeoutRef.current = setTimeout(() => {
      let remaining = 5 * 60; setCountdown(remaining);
      countdownRef.current = setInterval(() => {
        remaining--; setCountdown(remaining);
        if (remaining <= 0) { clearTimers(); setSessionExpired(true); setCountdown(null); clearAgentState(agent.id); }
      }, 1000);
    }, SESSION_TIMEOUT_MS - 5 * 60 * 1000);
  }, [clearTimers, agent.id]);

  const renewSession = useCallback(() => { setSessionExpired(false); setCountdown(null); clearAgentState(agent.id); startTimeout(); }, [startTimeout, agent.id]);
  useEffect(() => { startTimeout(); return clearTimers; }, [agent.id]);

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try { const r = await fetch(`${apiBase}/api/claw/business-files?agentId=${agent.id}`, { credentials: "include" }); if (r.ok) { const d = await r.json(); setFiles(d.files || []); } } finally { setFilesLoading(false); }
  }, [agent.id, apiBase]);

  const deleteFile = useCallback(async (fileName: string) => {
    try { await fetch(`${apiBase}/api/claw/business-files?agentId=${agent.id}&file=${encodeURIComponent(fileName)}`, { method: "DELETE", credentials: "include" }); setFiles(f => f.filter(x => x.name !== fileName)); } catch {}
  }, [agent.id, apiBase]);

  const clearFiles = useCallback(async () => {
    const ok = await confirm({
      title: "清空生成文件？",
      description: "清空所有生成的文件？",
      confirmText: "清空",
      variant: "danger",
    });
    if (!ok) return;
    try { await fetch(`${apiBase}/api/claw/business-files?agentId=${agent.id}&all=1`, { method: "DELETE", credentials: "include" }); setFiles([]); } catch {}
  }, [agent.id, apiBase, confirm]);

  useEffect(() => { fetchFiles(); const t = setInterval(fetchFiles, 30000); return () => clearInterval(t); }, [fetchFiles]);

  const sendMessage = () => {
    if (!input.trim() || streaming || sessionExpired) return;
    const text = input.trim(); setInput("");
    startTimeout();
    // Detached: keeps streaming into module store even if TaskPanel unmounts.
    void sendBusinessMessage(agent.id, text, apiBase, () => {
      let c = 0; const poll = () => { fetchFiles(); c++; if (c < 3) setTimeout(poll, 5000); }; setTimeout(poll, 2000);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {dialog}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "var(--oc-border)" }}>
        <button onClick={onBack} className="p-1 rounded hover:opacity-80 transition-colors"><ChevronLeft size={16} style={{ color: "var(--oc-text-secondary)" }} /></button>
        <span className="flex items-center justify-center" style={{ width: 18, height: 18 }}>{renderAgentIcon(agent, 18)}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--oc-text-primary)" }}>{agent.name}</div>
          <div className="text-[10px]" style={{ color: "var(--oc-text-secondary)" }}>{getAgentSubtitle(agent)}</div>
        </div>
        {countdown !== null && <span className="text-[10px] px-1.5 py-0.5 rounded animate-pulse" style={{ background: "rgba(239,68,68,0.15)", color: "var(--oc-danger)", border: "1px solid rgba(239,68,68,.3)" }}>{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")} 后超时</span>}
        {sessionKey && !countdown && <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(34,197,94,0.12)", color: "var(--oc-success)", border: "1px solid rgba(34,197,94,.25)" }}>进行中</span>}
        <button
          onClick={() => { setFileHistoryOpen(prev => { if (!prev) fetchFiles(); return !prev; }); }}
          title={fileHistoryOpen ? "关闭文件面板" : `历史文件 (${files.length})`}
          className="ml-1 p-1.5 rounded-md flex items-center gap-1 text-[10px] transition-colors"
          style={{
            color: fileHistoryOpen ? "#c7000b" : "var(--oc-text-secondary)",
            border: `1px solid ${fileHistoryOpen ? "rgba(199,0,11,0.5)" : "var(--oc-border)"}`,
            background: fileHistoryOpen ? "rgba(199,0,11,0.08)" : "transparent",
          }}
        >
          <FolderOpen size={12} />
          {files.length > 0 && <span className="font-mono" style={{ color: "#c7000b" }}>{files.length}</span>}
        </button>
      </div>
      {sessionExpired && <div className="mx-4 mt-3 rounded-lg px-3 py-2.5 text-xs" style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", color: "var(--oc-danger)" }}><div className="font-semibold">⏰ 会话已超时</div><button onClick={renewSession} className="mt-1.5 px-2.5 py-1 rounded text-[11px] font-medium" style={{ background: "rgba(239,68,68,.2)", border: "1px solid rgba(239,68,68,.35)", color: "var(--oc-danger)", cursor: "pointer" }}>开启新会话</button></div>}
      <div className="flex-1 min-h-0 flex" style={{ overflow: "hidden" }}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {agent.id === "task-hermes" && msgs.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-1 text-[10px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.5 }}>
            <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#22c55e", opacity: 0.8 }} />
            共享空间 · 对话将沉淀为团队记忆
          </div>
        )}
        {msgs.length === 0 && !sessionExpired && <div className="text-center py-8">
          {agent.uiConfig ? (
            <ConfiguredAgentWelcome agent={agent} onPickExample={setInput} />
          ) : agent.id === "task-hermes" ? (
            <>
              <div className="flex items-center justify-center"><Dna size={40} style={{ color: "#be1e2d" }} /></div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵枢 · 共享智脑（Hermes Agent）</p>
              <p className="text-xs mt-1.5 max-w-[260px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>融合信贷、债券、理财、保险四大专业能力，自动调用对应分析工具</p>
              <div className="mt-4 mx-auto max-w-[240px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(190,30,45,0.04)", border: "1px solid rgba(190,30,45,0.12)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {["综合方案：客户贷款3000万建厂，做信贷评估+厂房估值+设备保险", "用debt工具分析5年期国开债的久期和凸性", "用理财工具做一个50万的稳健型资产配置方案", "新能源车追尾事故，用EV理赔工具评估电池损伤"].map((q) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}>{q}</p>
                ))}
              </div>
              <p className="text-[10px] mt-3 flex items-center justify-center gap-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.5 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#22c55e", opacity: 0.8 }} />
                共享空间 · 对话将沉淀为团队记忆
              </p>
            </>
          ) : agent.id === "task-stock" ? (
            <>
              <div className="flex items-center justify-center text-3xl">📈</div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵犀 · 股票分析</p>
              <p className="text-xs mt-1.5 max-w-[260px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>AI 驱动的多策略选股分析，支持 A 股、港股、美股</p>
              <div className="mt-4 mx-auto max-w-[260px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "用缠论分析茅台 600519", icon: "🔮" },
                  { q: "分析比亚迪的多头趋势", icon: "📊" },
                  { q: "波浪理论看宁德时代 300750", icon: "🌊" },
                  { q: "帮我看看腾讯 hk00700 的均线", icon: "📉" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span>{icon}</span>{q}</p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {["多头趋势", "均线金叉", "缩量回踩", "放量突破", "缠论", "波浪理论", "龙头策略", "情绪周期"].map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "rgba(34,197,94,0.08)", color: "var(--oc-success)", border: "1px solid rgba(34,197,94,0.15)" }}>{s}</span>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>支持多轮对话 · DeepSeek 驱动</p>
            </>
          ) : ENGINE_ICON[agent.id] ? (
            <>
              <AgentHeroAnimation agentId={agent.id} />
              <p className="text-sm mt-4 font-medium" style={{ color: "var(--oc-text-primary)" }}>{agent.name}</p>
              <p className="text-xs mt-1" style={{ color: "var(--oc-text-secondary)" }}>{agentDesc(agent.id, agent.description)}</p>
              <p className="text-[10px] mt-2" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>支持多轮对话 · 30分钟无操作自动终止</p>
            </>
          ) : agent.id === "task-code" ? (
            <>
              <div className="flex items-center justify-center"><Code2 size={40} style={{ color: "#c7000b" }} /></div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵匠 · 代码助手</p>
              <p className="text-xs mt-1.5 max-w-[260px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>沙箱执行 · 多语言 · 文件产出可下载</p>
              <div className="mt-4 mx-auto max-w-[260px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(199,0,11,0.04)", border: "1px solid rgba(199,0,11,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "写一个 Python 脚本批量重命名文件", icon: "🐍" },
                  { q: "用 Node.js 写个 HTTP 文件服务器", icon: "🌐" },
                  { q: "帮我写一个二叉树的前中后序遍历", icon: "🌳" },
                  { q: "Python 解析 Excel 并导出 JSON", icon: "📊" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span>{icon}</span>{q}</p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>多语言代码沙箱 · Claude 驱动</p>
            </>
          ) : agent.id === "task-slides" ? (
            <>
              <div className="flex items-center justify-center"><Presentation size={40} style={{ color: "#c7000b" }} /></div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵匠 · 幻灯片（HTML）</p>
              <p className="text-xs mt-1.5 max-w-[260px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>动画丰富的网页幻灯片 · 一句话生成</p>
              <div className="mt-4 mx-auto max-w-[260px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(199,0,11,0.04)", border: "1px solid rgba(199,0,11,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "做一个介绍员工智能体的 HTML 幻灯片，带动画", icon: "✨" },
                  { q: "5 页 Q4 业务回顾的网页演示", icon: "📈" },
                  { q: "做一个产品发布会的 HTML slides", icon: "🚀" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span>{icon}</span>{q}</p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>HTML 幻灯片生成 · Claude 驱动</p>
            </>
          ) : agent.id === "task-credit-risk" ? (
            <>
              <div className="flex items-center justify-center">
                <div style={{ position: "relative", width: 88, height: 88 }}>
                  <div style={{
                    width: 88, height: 88, borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, rgba(190,30,45,0.18), rgba(190,30,45,0.05) 60%, transparent 80%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Compass size={48} style={{ color: "#be1e2d" }} />
                  </div>
                  <span className="credit-risk-pulse" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid rgba(190,30,45,0.35)", pointerEvents: "none" }} />
                  <style>{`
                    .credit-risk-pulse { animation: credit-risk-ring 2.5s ease-out infinite; }
                    @keyframes credit-risk-ring { 0% { transform: scale(0.85); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
                  `}</style>
                </div>
              </div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵犀 · 智贷决策助手</p>
              <p className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>商业银行信贷风控 · 银保监 + 头部大行大模型三框架</p>
              <div className="mt-4 mx-auto max-w-[280px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(190,30,45,0.04)", border: "1px solid rgba(190,30,45,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "上海某科技公司申请 3000 万 3 年经营贷，给个完整审贷建议", icon: "📑" },
                  { q: "某制造业老客户最近被列为被执行人，怎么处置？", icon: "🔍" },
                  { q: "客户用苏州工业园区 5000 平米厂房抵押，估值合理吗？最多放多少？", icon: "🏠" },
                  { q: "为什么头部大行大模型平台能把审批时效从 7 天压到 8 小时？", icon: "🏛️" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-start gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span className="shrink-0">{icon}</span><span>{q}</span></p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>银保监三查 · 智贷平台 5 大类能力 · 7 工具协作</p>
            </>
          ) : agent.id === "task-bond" ? (
            <>
              <div className="flex items-center justify-center">
                <div style={{ position: "relative", width: 88, height: 88 }}>
                  <div style={{
                    width: 88, height: 88, borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, rgba(190,30,45,0.18), rgba(190,30,45,0.05) 60%, transparent 80%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <BarChart3 size={48} style={{ color: "#be1e2d" }} />
                  </div>
                  <span className="bond-pulse" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid rgba(190,30,45,0.35)", pointerEvents: "none" }} />
                  <style>{`
                    .bond-pulse { animation: bond-ring 2.5s ease-out infinite; }
                    @keyframes bond-ring { 0% { transform: scale(0.85); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
                  `}</style>
                </div>
              </div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵犀 · 债券投研助手</p>
              <p className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>债券投研 · 中央结算 + 中诚信 双权威框架 · 中债真实数据</p>
              <div className="mt-4 mx-auto max-w-[280px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(190,30,45,0.04)", border: "1px solid rgba(190,30,45,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "5 年期国债当前 YTM 多少？最近 30 天变化怎样？", icon: "📉" },
                  { q: "我有 5000 万 5 年期国债，美联储降息 50bp 价格涨多少？", icon: "⏱️" },
                  { q: "AA+ 评级 5 年期信用债当前利差多少？算预警吗？", icon: "📊" },
                  { q: "用中诚信 5 因子框架分析某地产民企的违约风险", icon: "⚠️" },
                  { q: "中央结算公司中债估值方法论是什么？", icon: "🏛️" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-start gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span className="shrink-0">{icon}</span><span>{q}</span></p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>akshare 中债真实数据 · Hermes 多 persona · 6 工具协作</p>
            </>
          ) : agent.id === "task-my-wealth" ? (
            <>
              <div className="flex items-center justify-center">
                <div style={{ position: "relative", width: 88, height: 88 }}>
                  <div style={{
                    width: 88, height: 88, borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, rgba(190,30,45,0.18), rgba(190,30,45,0.05) 60%, transparent 80%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <TrendingUp size={48} style={{ color: "#be1e2d" }} />
                  </div>
                  <span className="my-wealth-pulse" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid rgba(190,30,45,0.35)", pointerEvents: "none" }} />
                  <style>{`
                    .my-wealth-pulse { animation: my-wealth-ring 2.5s ease-out infinite; }
                    @keyframes my-wealth-ring { 0% { transform: scale(0.85); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
                  `}</style>
                </div>
              </div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵犀 · 个人理财助手</p>
              <p className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>您的专属 AI 理财顾问 · 中行 + 招行 双白皮书 grounding</p>
              <div className="mt-4 mx-auto max-w-[280px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(190,30,45,0.04)", border: "1px solid rgba(190,30,45,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "看看我现在的持仓配置怎么样，按中行白皮书该怎么调？", icon: "📊" },
                  { q: "查一下贵州茅台现在的价格和最近一个月走势", icon: "📈" },
                  { q: "易方达蓝筹精选混合最近表现如何？", icon: "💼" },
                  { q: "现在最新 CPI 是多少？M2 同比呢？", icon: "🌐" },
                  { q: "如果我现在卖出 5 万元贵州茅台，要交多少税？", icon: "💰" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-start gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span className="shrink-0">{icon}</span><span>{q}</span></p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>akshare 开源数据 · Hermes 多 persona · 7 工具协作</p>
            </>
          ) : agent.id === "task-claim-ev" ? (
            <>
              <div className="flex items-center justify-center">
                <div style={{ position: "relative", width: 88, height: 88 }}>
                  <div style={{
                    width: 88, height: 88, borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, rgba(34,197,94,0.18), rgba(34,197,94,0.05) 60%, transparent 80%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 56,
                  }}>🔋</div>
                  <span className="claim-ev-pulse" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid rgba(34,197,94,0.35)", pointerEvents: "none" }} />
                  <style>{`
                    .claim-ev-pulse { animation: claim-ev-ring 2.5s ease-out infinite; }
                    @keyframes claim-ev-ring { 0% { transform: scale(0.85); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
                  `}</style>
                </div>
              </div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵犀 · EV 理赔决策助手</p>
              <p className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>新能源车专属理赔决策 · 基于人保再保《动力电池保险创新白皮书》</p>
              <div className="mt-4 mx-auto max-w-[280px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {[
                  { q: "奔腾 B70 EV，时速 30km 撞了路肩，左前覆盖件凹陷，需要全检电池吗？", icon: "💥" },
                  { q: "比亚迪汉 EV 全损，电池容量 84 度 SoH 77%，电池怎么处置？", icon: "💎" },
                  { q: "特斯拉 Model Y 50km/h 撞底盘，怎么走理赔？", icon: "🔧" },
                  { q: "解释一下白皮书的「电池循环经济」创新方案", icon: "📘" },
                ].map(({ q, icon }) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity flex items-start gap-1.5" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}><span className="shrink-0">{icon}</span><span>{q}</span></p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>Hermes 多 persona 引擎 · 团队脑共享记忆</p>
            </>
          ) : agent.id === "task-trace" ? (
            <>
              <div className="flex items-center justify-center">
                <div style={{ position: "relative", width: 96, height: 96 }}>
                  <img src="/uploads/panda_no_bg.png?v=2" alt="作者头像" className="trace-panda" style={{ width: 96, height: 96, objectFit: "contain", display: "block" }} />
                  <span className="trace-pulse" style={{ position: "absolute", inset: -6, borderRadius: "50%", border: "2px solid rgba(190,30,45,0.3)", pointerEvents: "none" }} />
                  <style>{`
                    .trace-pulse { animation: trace-ring 2s ease-out infinite; }
                    @keyframes trace-ring { 0% { transform: scale(0.85); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
                    .trace-panda { animation: trace-panda-bob 3s ease-in-out infinite; }
                    @keyframes trace-panda-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
                  `}</style>
                </div>
              </div>
              <p className="text-sm mt-3 font-semibold" style={{ color: "var(--oc-text-primary)" }}>灵枢 · 深度求索</p>
              <p className="text-xs mt-1.5 max-w-[260px] mx-auto leading-relaxed" style={{ color: "var(--oc-text-secondary)" }}>交付复杂任务，自动拆解规划、逐步推进</p>
              <div className="mt-4 mx-auto max-w-[240px] rounded-lg px-3 py-2.5 text-left" style={{ background: "rgba(190,30,45,0.04)", border: "1px solid rgba(190,30,45,0.12)" }}>
                <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--oc-text-secondary)" }}>试试问我</p>
                {["帮我分析微服务架构的优缺点", "制定一个产品上线计划", "研究 AI Agent 的技术方案"].map((q) => (
                  <p key={q} className="text-[11px] py-0.5 cursor-pointer hover:opacity-70 transition-opacity" style={{ color: "var(--oc-text-primary)", opacity: 0.7 }} onClick={() => { setInput(q); }}>{q}</p>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>TRACE 五阶段推理 · DeepSeek 驱动</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center">{agentIcon(agent.id, 36)}</div>
              <p className="text-sm mt-2" style={{ color: "var(--oc-text-secondary)" }}>{agentDesc(agent.id, agent.description)}</p>
              <p className="text-xs mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.5 }}>支持多轮对话 · 30分钟无操作自动终止</p>
            </>
          )}
        </div>}
        {msgs.map((m, i) => {
          const isLast = i === msgs.length - 1; const isPlaceholder = isLast && m.role === "assistant" && !m.text && streaming;
          if (m.role === "user") return <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm lingxia-bubble-user lingxia-user-msg-text">{m.text}</div></div>;
          if (isPlaceholder) return <div key={i} className="flex items-start gap-2 lingxia-msg-fade"><span className="shrink-0 mt-1 flex items-center">{agentIcon(agent.id, 16)}</span><div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-2 lingxia-bubble-ai" style={{ color: "var(--oc-text-tertiary)" }}><span className="animate-pulse">●</span><span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span><span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>{m.status && <span className="text-xs ml-1" style={{ opacity: 0.8 }}>{m.status}</span>}</div></div>;
          {
            // Parse __files marker — 2026-04-27 fix double-encode bug (agent-side claude-code-proxy URL-encodes filenames; server-side keeps raw Chinese; take LAST = server-side authoritative)
            const allFilesMatches = [...m.text.matchAll(/<!-- __files:(\[.*?\]) -->/g)];
            const filesMatch = allFilesMatches.length > 0 ? allFilesMatches[allFilesMatches.length - 1] : null;
            const remoteFiles = filesMatch ? (() => { try { return JSON.parse(filesMatch[1]); } catch { return []; } })() : [];
            const cleanText = m.text.replace(/\n*<!-- __files:.*? -->/g, "").trim();
            // Defensive: filename may already be URL-encoded (agent-side variant); decode once before re-encoding to avoid %25 double-encode
            const tryDecodeName = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
            return <div key={i} className="flex items-start gap-2"><span className="shrink-0 mt-1 flex items-center">{agentIcon(agent.id, 16)}</span><div className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm min-w-0 lingxia-bubble-ai" style={{ maxWidth: "85%" }}>
              {/* Hermes reasoning — 仅当内容与正文不同且足够长时折叠显示 */}
              {m.reasoning && m.reasoning.length > 20 && !m.text.includes(m.reasoning.slice(0, 30)) && <details className="mb-2" style={{ fontSize: 12 }}><summary style={{ color: "var(--oc-text-secondary)", cursor: "pointer", userSelect: "none" }}>💭 思考过程</summary><pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--oc-text-secondary)", opacity: 0.7, fontSize: "var(--oc-text-xs)", marginTop: 4, maxHeight: 200, overflow: "auto" }}>{m.reasoning}</pre></details>}
              {/* Hermes tool calls */}
              {m.toolCalls && m.toolCalls.length > 0 && <div className="mb-2 space-y-1">{m.toolCalls.map((tc) => {
                const TOOL_ICONS: Record<string, string> = { web_search: "🔍", browser_navigate: "🌐", terminal: "💻", file_read: "📄", file_write: "📝", web_fetch: "🌐", memory_search: "🧠" };
                // 识别业务 Agent 调用（从 terminal preview 中的 skill 路径推断）
                const AGENT_MAP: Record<string, [string, string]> = {
                  "/finance/credit-risk/": ["💹", "灵犀·智贷决策"],
                  "/finance/bond/": ["📊", "灵犀·债券投研"],
                  "/personal/wealth/": ["💰", "灵犀·个人理财"],
                  "/insurance/ev-claim/": ["🚗", "灵犀·EV理赔"],
                };
                let agentLabel = "";
                let icon = TOOL_ICONS[tc.name] || "⚙️";
                if (tc.name === "terminal" && tc.preview) {
                  for (const [path, [agentIcon, agentName]] of Object.entries(AGENT_MAP)) {
                    if (tc.preview.includes(path)) {
                      icon = agentIcon;
                      agentLabel = agentName;
                      break;
                    }
                  }
                }
                const isRunning = tc.status === "running";
                const elapsed = tc.durationMs ? `${(tc.durationMs / 1000).toFixed(1)}s` : isRunning ? `${Math.round((Date.now() - tc.ts) / 1000)}s` : "";
                return <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--oc-radius-md)", background: isRunning ? "rgba(99,102,241,0.06)" : "rgba(120,120,140,0.04)", border: `1px solid ${isRunning ? "rgba(99,102,241,0.15)" : "rgba(120,120,140,0.1)"}`, fontSize: "var(--oc-text-sm)", color: isRunning ? "#818cf8" : "#8b8fa3", position: "relative", overflow: "hidden" }}>
                  {isRunning && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,rgba(99,102,241,.4),transparent)", backgroundSize: "200% 100%", animation: "hermes-shimmer 1.8s ease-in-out infinite" }} />}
                  <span style={{ fontSize: 13 }}>{icon}</span>
                  <span style={{ fontWeight: "var(--oc-weight-medium)" }}>{agentLabel || tc.name}</span>
                  {tc.preview && <span style={{ opacity: 0.6, fontSize: "var(--oc-text-xs)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tc.preview}</span>}
                  {isRunning ? <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0 }} /> : <span style={{ color: tc.status === "error" ? "#ef4444" : "#22c55e", fontSize: "var(--oc-text-xs)" }}>✓</span>}
                  {elapsed && <span style={{ fontSize: "var(--oc-text-2xs)", opacity: 0.5 }}>{elapsed}</span>}
                </div>;
              })}</div>}
              {cleanText && <ChatMarkdown content={cleanText} />}
              {isLast && streaming && cleanText && <span className="animate-pulse ml-0.5" style={{ color: "var(--oc-text-tertiary)" }}>▌</span>}
              {isLast && streaming && m.status && !cleanText && <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--oc-text-secondary)", opacity: 0.7 }}><span className="animate-pulse">●</span><span>{m.status}</span></div>}
              {remoteFiles.length > 0 && (() => {
                // 把同一个 base name 的 preview.html 和 pptx 合并成一张卡片
                const previews = remoteFiles.filter((f: any) => String(f.name).toLowerCase().endsWith("-preview.html"));
                const groups = previews.map((p: any) => {
                  const baseName = p.name.replace(/-preview\.html$/i, "");
                  const pptx = remoteFiles.find((f: any) =>
                    f.name === baseName + ".pptx" || f.name === baseName || f.name.replace(/\.pptx$/i, "") === baseName
                  );
                  return { preview: p, pptx };
                });
                const orphans = remoteFiles.filter((f: any) =>
                  !String(f.name).toLowerCase().endsWith("-preview.html") &&
                  !previews.some((p: any) => p.name.replace(/-preview\.html$/i, "") === String(f.name).replace(/\.pptx$/i, ""))
                );
                return (
                  <div className="mt-3 space-y-2">
                    {groups.map((g: any, fi: number) => {
                      const rf = g.preview;
                      const pptxFile = g.pptx || rf;
                      const previewUrl = "/api/claw/remote-file?agentId=" + encodeURIComponent(agent.id) + "&file=" + encodeURIComponent(tryDecodeName(rf.url?.split("/").pop() || rf.name)) + "&preview=1";
                      const dlName = tryDecodeName(pptxFile.url?.split("/").pop() || pptxFile.name);
                      const dlUrl = "/api/claw/business-files/download?agentId=" + encodeURIComponent(agent.id) + "&file=" + encodeURIComponent(dlName);
                      const displayName = String(pptxFile.name).replace(/\.pptx$/i, "");
                      const openFullscreen = () => setPreviewModalData({ previewUrl, downloadUrl: dlUrl, fileName: pptxFile.name });
                      return (
                        <div key={fi} className="rounded-xl overflow-hidden relative group" style={{ border: "1px solid rgba(199,0,11,0.3)", background: "rgba(199,0,11,0.04)" }}>
                          <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", background: "#f8f8f8" }}>
                            <iframe
                              src={previewUrl}
                              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                              sandbox="allow-scripts allow-same-origin"
                              title={displayName}
                            />
                            {/* 浮动标题条 - 左上 */}
                            <div className="absolute top-2 left-2 px-2 py-1 rounded-md flex items-center gap-1.5 text-[11px] font-medium" style={{ background: "rgba(0,0,0,0.6)", color: "var(--oc-text-on-accent)", backdropFilter: "blur(8px)", maxWidth: "60%", zIndex: 50 }}>
                              <Presentation className="w-3 h-3 shrink-0" style={{ color: "#ff6b6b" }} />
                              <span className="truncate">{displayName}</span>
                            </div>
                            {/* 浮动按钮组 - 右上 */}
                            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity" style={{ zIndex: 50 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); openFullscreen(); }}
                                title="全屏预览"
                                className="w-7 h-7 rounded-md flex items-center justify-center transition-all hover:scale-110"
                                style={{ background: "rgba(0,0,0,0.65)", color: "var(--oc-text-on-accent)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
                              >
                                <Maximize2 className="w-3 h-3" />
                              </button>
                              <a
                                href={dlUrl}
                                download={pptxFile.name}
                                onClick={(e) => e.stopPropagation()}
                                title="下载 PPTX"
                                className="w-7 h-7 rounded-md flex items-center justify-center transition-all hover:scale-110"
                                style={{ background: "rgba(199,0,11,0.9)", color: "var(--oc-text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", textDecoration: "none" }}
                              >
                                <Download className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {orphans.map((rf: any, oi: number) => {
                      const dlUrl = "/api/claw/business-files/download?agentId=" + encodeURIComponent(agent.id) + "&file=" + encodeURIComponent(tryDecodeName(rf.url?.split("/").pop() || rf.name));
                      return (
                        <div key={"orph-" + oi} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ border: "1px solid rgba(199,0,11,0.3)", background: "rgba(199,0,11,0.04)" }}>
                          <Presentation className="w-4 h-4 shrink-0" style={{ color: "#c7000b" }} />
                          <span className="text-xs truncate flex-1" style={{ color: "var(--oc-text-primary)" }}>{rf.name}</span>
                          <a href={dlUrl} download={rf.name} className="px-2 py-1 rounded-md text-[10px] font-medium flex items-center gap-1" style={{ color: "var(--oc-text-on-accent)", background: "#c7000b", textDecoration: "none" }}><Download className="w-3 h-3" />下载</a>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div></div>;
          }
        })}
        <div ref={bottomRef} />
      </div>
      {/* 右侧 inline 文件面板（CodeAgentView 风格，非 overlay） */}
      {fileHistoryOpen && (
        <div className="w-60 shrink-0 flex flex-col" style={{ borderLeft: "1px solid var(--oc-border)", background: "var(--oc-card)" }}>
          <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--oc-border)" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--oc-text-secondary)" }}>
              <FolderOpen size={12} style={{ color: "#c7000b" }} />
              <span>文件</span>
              <span className="font-mono text-[10px] normal-case tracking-normal" style={{ color: "#c7000b" }}>({files.length})</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => fetchFiles()} disabled={filesLoading} className="p-1 rounded" title="刷新" style={{ color: "var(--oc-text-secondary)", border: "none", background: "none", cursor: "pointer" }}>
                {filesLoading ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              </button>
              <button onClick={() => setFileHistoryOpen(false)} className="p-1 rounded" title="关闭" style={{ color: "var(--oc-text-secondary)", border: "none", background: "none", cursor: "pointer" }}>
                <X size={12} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {files.length === 0 && !filesLoading && (
              <div className="text-center py-8 text-[11px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.55 }}>
                暂无文件
              </div>
            )}
            {files.map((f: any) => {
              const isPptx = /\.pptx$/i.test(f.name);
              const isPreview = /-preview\.html$/i.test(f.name);
              return (
                <div key={f.name} className="px-2.5 py-1.5 flex items-center gap-1.5 group hover:bg-black/5 transition-colors">
                  {isPptx ? <Presentation className="w-3 h-3 shrink-0" style={{ color: "#c7000b" }} /> :
                   isPreview ? <BarChart3 className="w-3 h-3 shrink-0" style={{ color: "#c7000b" }} /> :
                   <Presentation className="w-3 h-3 shrink-0" style={{ color: "var(--oc-text-secondary)" }} />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] truncate" style={{ color: "var(--oc-text-primary)" }} title={f.name}>
                      {f.name.replace(/\.(pptx|html)$/i, "").replace(/-preview$/, "")}
                    </div>
                    {f.size > 0 && <div className="text-[9px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.7 }}>{fmtSize(f.size)}</div>}
                  </div>
                  <div className="flex items-center gap-0 opacity-40 group-hover:opacity-100 transition-opacity shrink-0">
                    <a
                      href={`/api/claw/business-files/download?agentId=${encodeURIComponent(agent.id)}&file=${encodeURIComponent(f.name)}`}
                      download={f.name}
                      className="p-1 rounded"
                      title="下载"
                      style={{ color: "#c7000b", textDecoration: "none" }}
                    >
                      <Download size={10} />
                    </a>
                    <button
                      onClick={() => deleteFile(f.name)}
                      className="p-1 rounded"
                      title="删除"
                      style={{ color: "var(--oc-danger)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {files.length > 0 && (
            <div className="shrink-0 px-2 py-2" style={{ borderTop: "1px solid var(--oc-border)" }}>
              <button
                onClick={clearFiles}
                className="w-full py-1 rounded text-[10px] transition-colors"
                style={{ color: "var(--oc-danger)", border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.04)", cursor: "pointer" }}
              >
                清空全部
              </button>
            </div>
          )}
        </div>
      )}
      </div>
      {agent.id === "task-stock" && !streaming && msgs.length > 0 && (
        <div className="px-4 py-2 border-t shrink-0 flex items-center justify-center" style={{ borderColor: "var(--oc-border)" }}>
          <a href="/api/claw/stock-webui/" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80" style={{ color: "var(--oc-success)", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", textDecoration: "none" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            打开完整面板（回测 · 持仓 · 历史）
          </a>
        </div>
      )}
      <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "var(--oc-border)" }}>
        <div className="business-chat-composer flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", opacity: sessionExpired ? 0.5 : 1 }}>
          <button onClick={renewSession} title="新会话" className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center hover:opacity-80 transition-colors" style={{ background: "var(--oc-border)", border: "none" }}><Plus size={14} style={{ color: "var(--oc-text-secondary)" }} /></button><textarea value={input} disabled={sessionExpired} onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={sessionExpired ? "会话已超时" : getAgentPromptPlaceholder(agent)} rows={1} className="business-chat-input flex-1 bg-transparent text-sm resize-none focus:outline-none" style={{ color: "var(--oc-text-primary)", lineHeight: "24px", height: 28, minHeight: 28, maxHeight: 100, overflowY: "hidden", padding: "2px 0" }} />
          <button onClick={toggleRecording} disabled={sessionExpired} className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-colors" style={{ background: recording ? "#ef4444" : "var(--oc-border)", border: "none" }} title={recording ? "停止录音" : "语音输入"}>{recording ? <MicOff size={13} color="white" /> : <Mic size={13} style={{ color: "var(--oc-text-secondary)" }} />}</button>
          {streaming ? (<button onClick={() => stopBusinessMessage(agent.id)} title="停止生成" className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-colors" style={{ background: "#ef4444", border: "none" }}><Square size={11} color="white" fill="white" /></button>) : (<button onClick={sendMessage} disabled={!input.trim() || sessionExpired} className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-25 active:scale-90" style={{ background: "var(--oc-accent)", border: "none" }}><Send size={12} color="white" /></button>)}
        </div>
        <p className="text-[10px] mt-1 text-center" style={{ color: "var(--oc-text-secondary)", opacity: 0.4 }}>Enter 发送 · 30分钟无操作自动终止</p>
      </div>
      {/* ── Manus 级全屏预览模态框（Portal 到 document.body 避免 stacking context trap）── */}
      {previewModalData && typeof document !== "undefined" && createPortal(
        <SlidePreviewModal
          open={!!previewModalData}
          onClose={() => setPreviewModalData(null)}
          previewUrl={previewModalData.previewUrl}
          downloadUrl={previewModalData.downloadUrl}
          fileName={previewModalData.fileName}
        />,
        document.body
      )}
    </div>
  );
}

// ── 折叠分组组件（参考 SkillsPanel.Group 风格）──────────────────────────
function CollabGroup({
  id, title, icon, count, badge, collapsed, setCollapsed, children,
}: {
  id: string; title: string; icon: React.ReactNode; count: number;
  badge?: { count: number; color: string };
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  children: React.ReactNode;
}) {
  const isCollapsed = !!collapsed[id];
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--oc-border)" }}>
      <button
        onClick={() => setCollapsed(p => ({ ...p, [id]: !p[id] }))}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:opacity-90"
        style={{ background: "var(--oc-input-bg)", border: "none", cursor: "pointer" }}
      >
        <span style={{ color: "var(--oc-text-secondary)", display: "flex", alignItems: "center" }}>{icon}</span>
        <span className="text-xs font-semibold flex-1" style={{ color: "var(--oc-text-primary)" }}>{title}</span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold leading-none" style={{ background: badge.color, color: "var(--oc-text-on-accent)", minWidth: 16, textAlign: "center" }}>{badge.count}</span>
        )}
        <span className="text-[10px]" style={{ color: "var(--oc-text-secondary)" }}>{count > 0 ? count : ""}</span>
        <span className="text-[10px] ml-0.5" style={{ color: "var(--oc-text-secondary)", transform: isCollapsed ? "none" : "rotate(90deg)", display: "inline-block", transition: "transform 0.15s" }}>▶</span>
      </button>
      {!isCollapsed && (
        <div className="px-3 pb-3 pt-2" style={{ borderTop: "1px solid var(--oc-border)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function AgentListButton({ agent, onOpen }: { agent: BusinessAgent; onOpen: (agent: BusinessAgent) => void }) {
  const templateMeta = AGENT_TEMPLATE_META[getAgentTemplate(agent)] || AGENT_TEMPLATE_META.general_chat;
  return (
    <button
      key={agent.id}
      onClick={() => onOpen(agent)}
      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:opacity-80 active:scale-[0.99]"
      style={{ background: "var(--oc-bg-hover)", border: "1px solid var(--oc-border)", cursor: "pointer" }}
    >
      <span className="flex items-center justify-center" style={{ width: 20, height: 20 }}>{renderAgentIcon(agent, 20)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium" style={{ color: "var(--oc-text-primary)" }}>{agent.name}</div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--oc-text-secondary)" }}>{getAgentCardDescription(agent)}</div>
      </div>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: "color-mix(in oklab, var(--oc-accent) 8%, transparent)", color: templateMeta.accent, border: "1px solid color-mix(in oklab, var(--oc-accent) 18%, transparent)" }}>{templateMeta.label}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: "color-mix(in oklab, var(--oc-accent) 15%, transparent)", color: "var(--oc-accent)", border: "1px solid color-mix(in oklab, var(--oc-accent) 30%, transparent)" }}>用 →</span>
    </button>
  );
}

// ── 智能体广场主面板 ────────────────────────────────────────────────────────
export function CollabDrawer({ onClose, adoptId }: { onClose: () => void; adoptId?: string }) {
  const [bizAgents, setBizAgents] = useState<BusinessAgent[]>([]);
  const apiBase = (import.meta as any).env?.VITE_API_URL || "";
  const [bizLoading, setBizLoading] = useState(true);
  const [activeAgent, setActiveAgent] = useState<BusinessAgent | null>(null);
  const [prefillPrompt, setPrefillPrompt] = useState<string>("");
  const [activeCollab, setActiveCollab] = useState<any | null>(null);
  const [visible, setVisible] = useState(false);
  const [requestModal, setRequestModal] = useState<any | null>(null);
  const [mainTab, setMainTab] = useState<"market" | "mine">("market");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ biz: false, colleague: false, incoming: false, outgoing: false });
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("collab_drawer_width");
      const n = saved ? parseInt(saved, 10) : 380;
      return Number.isFinite(n) ? Math.min(1200, Math.max(320, n)) : 380;
    } catch { return 380; }
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }, []);
  const handleClose = () => { setVisible(false); setTimeout(onClose, 280); };

  useEffect(() => {
    try { localStorage.setItem("collab_drawer_width", String(drawerWidth)); } catch {}
  }, [drawerWidth]);

  const startResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const maxWidth = Math.min(1200, Math.floor(window.innerWidth * 0.85));
      const next = Math.min(maxWidth, Math.max(320, startWidth + delta));
      setDrawerWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [drawerWidth]);

  useEffect(() => {
    fetch(`${apiBase}/api/claw/business-agents`, { credentials: "include" })
      .then(r => r.json()).then(d => setBizAgents(d.agents || [])).catch(() => {}).finally(() => setBizLoading(false));
  }, []);

  // 消费主聊天推荐卡片写入的预填意图：自动跳到对应 agent 的 TaskPanel 并预填 prompt
  useEffect(() => {
    if (!bizAgents.length) return;
    try {
      const raw = sessionStorage.getItem("collab_prefill");
      if (!raw) return;
      sessionStorage.removeItem("collab_prefill");
      const { agentId, prompt } = JSON.parse(raw) as { agentId?: string; prompt?: string };
      if (!agentId) return;
      const found = bizAgents.find((a) => a.id === agentId);
      if (found) {
        setActiveAgent(found);
        setPrefillPrompt(prompt || "");
      }
    } catch {}
  }, [bizAgents]);

  const hasAdoptId = !!adoptId;
  const directoryQ = trpc.collab.directory.useQuery({ adoptId: adoptId || "" }, { enabled: hasAdoptId, retry: false, refetchInterval: 60000 });
  const colleagues = (directoryQ.data || []).filter((a: any) => a.acceptTask !== "off");

  const outgoingQ = trpc.collab.outgoing.useQuery({ adoptId: adoptId || "" }, { enabled: hasAdoptId, retry: false, refetchInterval: 30000 });
  const pendingCount = useMemo(() => (outgoingQ.data || []).filter((r: any) => ["pending", "approved", "running"].includes(r.status)).length, [outgoingQ.data]);

  const incomingQ = trpc.collab.incoming.useQuery({ adoptId: adoptId || "" }, { enabled: hasAdoptId, retry: false, refetchInterval: 20000 });
  const actionableCount = useMemo(() => (incomingQ.data || []).filter((r: any) =>
    r.status === "pending" || (["completed", "partial_success"].includes(r.status) && !r.resultEnvelope?.deliveredAt)
  ).length, [incomingQ.data]);

  return (
    <>
      {requestModal && adoptId && <RequestModal agent={requestModal} requesterAdoptId={adoptId} onClose={() => setRequestModal(null)} onSuccess={() => { setRequestModal(null); outgoingQ.refetch(); }} />}

      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: drawerWidth, zIndex: 50, background: "var(--oc-bg)", borderLeft: "1px solid var(--oc-border)", display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.15)", transform: visible ? "translateX(0)" : "translateX(100%)", transition: resizing ? "none" : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)", willChange: "transform" }}>
        <div
          onMouseDown={startResize}
          title="拖拽调整宽度"
          style={{ position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 60, background: resizing ? "color-mix(in oklab, var(--oc-accent) 25%, transparent)" : "transparent" }}
        >
          <div style={{ position: "absolute", left: 3, top: 0, bottom: 0, width: 2, background: resizing ? "var(--oc-accent)" : "transparent", transition: "background 0.15s" }} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 shrink-0 border-b" style={{ borderColor: "var(--oc-border)", minHeight: 48 }}>
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--oc-accent)" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>智能体广场</span>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-md hover:opacity-80 transition-colors"><X size={15} style={{ color: "var(--oc-text-secondary)" }} /></button>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          {activeAgent ? (
            <TaskPanel key={activeAgent.id} agent={activeAgent} prefillPrompt={prefillPrompt} onBack={() => { setActiveAgent(null); setPrefillPrompt(""); }} />
          ) : activeCollab && adoptId ? (
            <CollabExecPanel req={activeCollab} adoptId={adoptId} onBack={() => setActiveCollab(null)} onDone={() => { setActiveCollab(null); incomingQ.refetch(); }} />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* 简化版（2026-04-17）：去掉「智能体广场 / 我的协作」mainTab 切换 + 同事智能体 + incoming/outgoing；
                  「我的协作」入口已搬到主 Sidebar 单独页；这里只保留「单纯的 task-xxx 业务智能体」入口。
                  旧 mainTab 切换条 + mine 分支 + 同事智能体折叠组的代码保留在 .bak-20260416-pre-simplify 备份里。 */}

              {/* 内容区 */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
                {(
                  <>
                    {/* ── 业务能力（折叠组） */}
                    {bizLoading ? <div className="flex items-center gap-2 py-3 justify-center"><Loader2 size={13} className="animate-spin" style={{ color: "var(--oc-text-secondary)" }} /><span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中...</span></div> : (
                      <>
                        {PLAZA_GROUPS.map((group) => {
                          const items = bizAgents.filter(a => normalizeUiConfig(a).category === group.id);
                          if (items.length === 0) return null;
                          return (
                            <CollabGroup key={group.id} id={`plaza-${group.id}`} title={group.title} icon={group.icon} count={items.length} collapsed={collapsed} setCollapsed={setCollapsed}>
                              <div className="space-y-1.5">
                                {items.map((agent) => <AgentListButton key={agent.id} agent={agent} onOpen={setActiveAgent} />)}
                              </div>
                            </CollabGroup>
                          );
                        })}
                      </>
                    )}

                    {/* 同事智能体 / incoming / outgoing 已下线（迁到 Sidebar「我的协作」），见 .bak-pre-simplify */}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
