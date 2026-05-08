import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ArrowDown,
  Bot,
  ChevronDown,
  CheckCircle2,
  Code2,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Maximize2,
  Paperclip,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { SlidePreviewModal } from "@/components/pages/SlidePreviewModal";

type TaskTemplate = {
  id: string;
  displayName: string;
  shortDescription: string;
  estimatedDurationMs: number;
  stages: Array<{
    id: string;
    displayName: string;
    personaId: string;
    agentDefinitionId: string;
  }>;
  outputPolicy: {
    allowedArtifactTypes: string[];
    disclaimers: string[];
  };
};

type Artifact = {
  id: string;
  type: string;
  name: string;
  mimeType?: string;
  downloadUrl?: string;
  previewUrl?: string;
  metadata?: Record<string, unknown>;
};

type TaskStageResult = {
  stageId: string;
  personaId: string;
  agentDefinitionId: string;
  status: "success" | "failed" | "skipped" | "timeout";
  durationMs: number;
  runResult?: {
    summary?: string;
    output?: string;
    error?: { code?: string; detail?: string };
    artifacts?: Artifact[];
    metadata?: Record<string, unknown>;
  };
  artifacts?: Artifact[];
  warnings?: string[];
};

type TaskRun = {
  taskRunId: string;
  taskTemplateId: string;
  taskTemplateVersion: number;
  status: "completed" | "partial_success" | "failed" | "timeout" | "cancelled";
  stages: TaskStageResult[];
  artifacts: Artifact[];
  disclaimers: string[];
  startedAt?: string;
  completedAt?: string;
};

type LiveStageState = {
  stageId: string;
  personaId: string;
  agentDefinitionId: string;
  displayName: string;
  status: "waiting" | "running" | "success" | "failed" | "timeout";
  events: string[];
  text: string;
  startedAt?: number;
  durationMs?: number;
  artifacts?: Artifact[];
  error?: string;
  runResult?: TaskStageResult["runResult"];
};

type StreamPayload = {
  type: string;
  event?: any;
  taskRun?: TaskRun;
  error?: { kind?: string; detail?: string };
};

type RouterDecision = {
  intent: "chat" | "clarify" | "run_template" | "unsupported";
  confidence: "high" | "medium" | "low";
  selectedTemplateId?: string;
  normalizedGoal?: string;
  userVisiblePlan?: string[];
  clarifyingQuestion?: string;
  reply?: string;
  router?: Record<string, unknown>;
};

type PreviewState = {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
};

type ResearchPreviewState = {
  title: string;
  metadata: Record<string, unknown>;
};

type WorkDirectoryPreviewState = {
  agentIds: string[];
};

type BusinessFile = {
  name: string;
  size?: number;
  updatedAt?: string;
};

const TASK_ICONS: Record<string, typeof FileText> = {
  market_research_brief: BarChart3,
  ppt_report_writing: Presentation,
  stock_ppt_report: TrendingUp,
};

const TASK_PLACEHOLDERS: Record<string, string> = {
  market_research_brief: "输入研究主题，例如：跨境支付行业的最新变化、机会和风险",
  ai_topic_insight_ppt: "输入你想研究的热点话题，例如：Sequoia Ascent 2026 的最新观点",
  ppt_report_writing: "输入要做成 PPT 的主题、受众和风格...",
  stock_ppt_report: "输入要研究的股票、报告用途和关注维度...",
};

const PERSONA_LABELS: Record<string, string> = {
  wenzhou: "闻舟 (AI) · 趋势洞察师",
  moheng: "墨衡 (AI) · 研究分析师",
  jianye: "简页 (AI) · 材料写作师",
  hengyue: "衡岳 (AI) · 股票数据研究员",
  qingzhan: "青栈 (AI) · 代码工程师",
};

const PERSONA_INITIALS: Record<string, string> = {
  wenzhou: "闻",
  moheng: "墨",
  jianye: "简",
  hengyue: "衡",
  qingzhan: "青",
};

const PERSONA_STEPS: Record<string, string[]> = {
  wenzhou: ["理解研究主题", "规划搜索路径", "筛选可信来源", "整理证据包"],
  moheng: ["阅读证据包", "提炼核心洞察", "标注引用来源", "复核合规边界"],
  jianye: ["理解任务与材料", "整理结构大纲", "生成研究材料", "准备交付说明"],
  hengyue: ["读取股票数据", "分析走势与风险", "生成研究结论"],
  qingzhan: ["理解代码需求", "规划实现路径", "生成代码建议"],
};

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  wenzhou: "搜索、筛选并组织可信资料，输出结构化证据包。",
  moheng: "复核证据质量，提炼逻辑线、风险点和引用依据。",
  jianye: "将研究材料整理成简报、汇报稿或可交付材料。",
  hengyue: "读取行情与指标，生成股票数据研究和风险提示。",
  qingzhan: "协助代码分析、改造建议和工程化落地。",
};

const PERSONA_COLORS: Record<string, { fg: string; bg: string; soft: string }> = {
  wenzhou: { fg: "#1d4ed8", bg: "#2563eb", soft: "rgba(37,99,235,0.10)" },
  moheng: { fg: "#047857", bg: "#059669", soft: "rgba(5,150,105,0.10)" },
  jianye: { fg: "#6d28d9", bg: "#7c3aed", soft: "rgba(124,58,237,0.10)" },
  hengyue: { fg: "#be123c", bg: "#e11d48", soft: "rgba(225,29,72,0.10)" },
  qingzhan: { fg: "#0f766e", bg: "#0d9488", soft: "rgba(13,148,136,0.10)" },
};

const PERSONA_ICONS: Record<string, typeof Bot> = {
  wenzhou: Search,
  moheng: ShieldCheck,
  jianye: Presentation,
  hengyue: BarChart3,
  qingzhan: Code2,
};

const DISCLAIMER_LABELS: Record<string, string> = {
  ai_generated_label: "AI 生成标识",
  investment_advisory: "非投资建议",
  code_review_required: "代码需人工 Review",
  fact_check_required: "事实需核查",
};

function formatDuration(ms?: number) {
  if (!ms && ms !== 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)} 分钟`;
}

function statusMeta(status: string) {
  if (status === "completed" || status === "success") return { label: "已完成", icon: CheckCircle2, color: "#15803d" };
  if (status === "failed" || status === "timeout") return { label: status === "timeout" ? "已超时" : "失败", icon: XCircle, color: "#b91c1c" };
  if (status === "partial_success") return { label: "部分完成", icon: AlertTriangle, color: "#b45309" };
  if (status === "running") return { label: "运行中", icon: Loader2, color: "var(--oc-accent)" };
  if (status === "waiting") return { label: "等待中", icon: Clock3, color: "var(--oc-text-tertiary)" };
  return { label: status, icon: Clock3, color: "var(--oc-text-secondary)" };
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function artifactSize(artifact: Artifact) {
  const size = artifact.metadata?.size;
  return typeof size === "number" ? size : undefined;
}

function cleanText(text: string) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function renderInline(text: string) {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={`${part}-${index}`} className="rounded-md px-1 py-0.5 text-[0.92em]" style={{ background: "var(--oc-bg-soft)" }}>
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${part}-${index}`}>{part}</span>;
    });
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isMarkdownBlockStart(line: string, nextLine?: string) {
  const trimmed = line.trim();
  return (
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    (trimmed.startsWith("|") && Boolean(nextLine && isTableSeparator(nextLine)))
  );
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      const cls = level === 1 ? "text-2xl font-semibold" : level === 2 ? "text-xl font-semibold" : "text-base font-semibold";
      blocks.push(
        <div key={`h-${i}`} className={cls} style={{ color: "var(--oc-text-primary)" }}>
          {content}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-0 border-t" style={{ borderColor: "var(--oc-border)" }} />);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|") && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--oc-border)" }}>
          <table className="min-w-full border-collapse text-sm">
            <thead style={{ background: "var(--oc-bg-soft)" }}>
              <tr>
                {header.map((cell, index) => (
                  <th key={`${cell}-${index}`} className="border-b px-3 py-2 text-left font-semibold" style={{ borderColor: "var(--oc-border)" }}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className={rowIndex % 2 ? "bg-black/[0.015]" : ""}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`} className="border-b px-3 py-2 align-top" style={{ borderColor: "var(--oc-border)" }}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quotes.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`quote-${i}`} className="rounded-2xl border-l-4 px-4 py-3 text-sm leading-7" style={{ borderColor: "var(--oc-accent)", background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
          {quotes.map((quote, index) => (
            <p key={`${quote}-${index}`}>{renderInline(quote)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && pattern.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(pattern, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`list-${i}`} className={`space-y-2 pl-5 text-[15px] leading-7 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !isMarkdownBlockStart(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="text-[15px] leading-8" style={{ color: "var(--oc-text-primary)" }}>
        {renderInline(paragraph.join(" "))}
      </p>
    );
  }

  return <div className="space-y-5">{blocks}</div>;
}

function appendLimited(list: string[], item: string, limit = 20) {
  const trimmed = item.trim();
  if (!trimmed) return list;
  const next = list[list.length - 1] === trimmed ? list : [...list, trimmed];
  return next.slice(Math.max(0, next.length - limit));
}

function normalizeProgressMessage(message: string) {
  const text = cleanText(String(message || "")).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("__files") || lower.includes("files ready")) return "整理交付文件";
  if (lower.includes("ppt") || lower.includes("slide") || lower.includes("ppt-insight")) return "调用 PPT 生成技能";
  if (/^\$?\s*node\b/.test(text) || lower.includes("/home/ubuntu") || lower.includes(".claude/skills")) return "准备 Agent 执行环境";
  if (text.includes("处理中") || lower.includes("processing")) return "正在生成内容";
  if (text.length > 80) return `${text.slice(0, 80)}...`;
  return text;
}

function personaLabel(stage: Pick<TaskStageResult, "personaId"> | { personaId: string }) {
  return PERSONA_LABELS[stage.personaId] || `${stage.personaId} (AI)`;
}

function personaShortLabel(personaId: string) {
  return personaLabel({ personaId }).replace(/\s*\(AI\)\s*·\s*/, " · ");
}

function personaRole(personaId: string) {
  const parts = personaLabel({ personaId }).split("·");
  return parts[1]?.trim() || "AI 专员";
}

function personaInitial(personaId: string) {
  return PERSONA_INITIALS[personaId] || "AI";
}

function personaColor(personaId: string) {
  return PERSONA_COLORS[personaId] || { fg: "var(--oc-accent)", bg: "var(--oc-accent)", soft: "var(--oc-bg-soft)" };
}

function PersonaGlyph({ personaId, stroke }: { personaId: string; stroke: string }) {
  const marker =
    personaId === "wenzhou" ? (
      <g transform="translate(31 31)">
        <circle cx="0" cy="0" r="5.2" fill="none" stroke={stroke} strokeWidth="2" />
        <path d="M4 4l5 5" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
      </g>
    ) : personaId === "moheng" ? (
      <g transform="translate(30 30)">
        <path d="M-4 1l3 3 7-8" fill="none" stroke={stroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ) : (
      <g transform="translate(29 29)">
        <rect x="-5" y="-4" width="12" height="9" rx="1.6" fill="none" stroke={stroke} strokeWidth="1.9" />
        <path d="M-2 -1h6M-2 2h3" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    );

  return (
    <svg viewBox="0 0 42 42" aria-hidden="true" className="h-full w-full">
      <circle cx="21" cy="21" r="20.25" fill="white" stroke="rgba(15,23,42,0.10)" />
      <path d="M9 33c2.5-6.2 6.8-8.8 12.6-8.8 5.3 0 9.2 2.5 11.4 8.8" fill={stroke} opacity="0.12" />
      <path d="M15.2 25.8c2 2.1 4.5 3.1 7.2 2.9" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      <path
        d="M23.8 9.4c-4.2-.8-8.2 1.6-9.1 5.9-.8 3.9.8 8 4 9.9 2.8 1.7 6.7 1 8.6-1.7 1.2-1.7 1.5-3.6 1-5.8-.5-2.6-1.1-4.4.7-6.1-1.4.3-2.8-.2-5.2-2.2z"
        fill={stroke}
        opacity="0.92"
      />
      <path d="M17.5 16.2c2.4.4 4.5.1 6.6-1.2" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <path d="M27.9 18.4c1.8.2 2.6 1 2.3 2.2-.2 1.1-1.1 1.8-2.5 2" fill="none" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
      <circle cx="17.9" cy="18.9" r="1" fill="white" opacity="0.85" />
      {marker}
    </svg>
  );
}

function PersonaAvatar({ personaId, size = "md", failed = false }: { personaId: string; size?: "xs" | "sm" | "md" | "lg"; failed?: boolean }) {
  const Icon = PERSONA_ICONS[personaId] || Bot;
  const color = personaColor(personaId);
  const sizeClass = size === "xs" ? "h-6 w-6 text-[10px]" : size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  const iconSize = size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 22 : 18;
  if (["wenzhou", "moheng", "jianye"].includes(personaId)) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ${sizeClass}`}
        style={{
          boxShadow: `0 10px 24px ${failed ? "rgba(185,28,28,0.18)" : color.soft}`,
          filter: failed ? "grayscale(0.25) saturate(0.8)" : undefined,
        }}
        title={personaLabel({ personaId })}
      >
        <PersonaGlyph personaId={personaId} stroke={failed ? "#b91c1c" : color.fg} />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass}`}
      style={{ background: failed ? "#b91c1c" : color.bg, boxShadow: `0 10px 24px ${failed ? "rgba(185,28,28,0.18)" : color.soft}` }}
      title={personaLabel({ personaId })}
    >
      {size === "xs" ? personaInitial(personaId) : <Icon size={iconSize} />}
    </span>
  );
}

function ArtifactCard({ artifact, onPreview }: { artifact: Artifact; onPreview: (artifact: Artifact) => void }) {
  const canPreview = Boolean(artifact.previewUrl);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact.previewUrl) {
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewHtml(null);
    setPreviewError(null);
    fetch(artifact.previewUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        if (cancelled) return;
        // 用 srcDoc 渲染，避开公网 iframe header / CSP 对直接嵌入的限制。
        setPreviewHtml(html.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, ""));
      })
      .catch((error: Error) => {
        if (!cancelled) setPreviewError(error.message || "preview_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.previewUrl]);

  return (
    <div className="overflow-hidden rounded-3xl border shadow-sm" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
      {canPreview ? (
        <div className="relative aspect-video bg-white">
          {previewHtml ? (
            <iframe title={artifact.name} srcDoc={previewHtml} sandbox="allow-scripts" className="absolute inset-0 h-full w-full border-0" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
              {previewError ? "内嵌预览加载失败，请使用全屏预览" : "正在加载预览..."}
            </div>
          )}
          <div className="absolute left-3 top-3 flex max-w-[68%] items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-white" style={{ background: "rgba(0,0,0,0.62)", backdropFilter: "blur(8px)" }}>
            <Presentation size={14} style={{ color: "#ffb3b3" }} />
            <span className="truncate">{artifact.name.replace(/\.pptx$/i, "")}</span>
          </div>
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button type="button" onClick={() => onPreview(artifact)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.16)" }} title="全屏预览">
              <Maximize2 size={14} />
            </button>
            {artifact.downloadUrl ? (
              <a href={artifact.downloadUrl} className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.16)" }} title="下载">
                <Download size={14} />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center" style={{ background: "var(--oc-bg-soft)" }}>
          <FileText size={26} style={{ color: "var(--oc-text-tertiary)" }} />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{artifact.name}</div>
            <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
              {artifact.type.toUpperCase()} {formatSize(artifactSize(artifact))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {canPreview ? (
              <button type="button" onClick={() => onPreview(artifact)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: "var(--oc-muted)", color: "var(--oc-text-primary)" }}>
                预览
              </button>
            ) : null}
            {artifact.downloadUrl ? (
              <a href={artifact.downloadUrl} className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: "var(--oc-accent)" }}>
                下载
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactArtifactCard({ artifact, onPreview }: { artifact: Artifact; onPreview: (artifact: Artifact) => void }) {
  const canPreview = Boolean(artifact.previewUrl);
  const Icon = artifact.type === "pptx" ? Presentation : FileText;
  return (
    <div className="flex items-center gap-4 rounded-3xl border p-4 shadow-sm" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-accent)" }}>
        <Icon size={24} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{artifact.name}</div>
        <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
          {artifact.type.toUpperCase()} {formatSize(artifactSize(artifact))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canPreview ? (
          <button type="button" onClick={() => onPreview(artifact)} className="rounded-full px-4 py-2 text-xs font-medium" style={{ background: "var(--oc-muted)", color: "var(--oc-text-primary)" }}>
            预览
          </button>
        ) : null}
        {artifact.downloadUrl ? (
          <a href={artifact.downloadUrl} className="rounded-full px-4 py-2 text-xs font-medium text-white" style={{ background: "var(--oc-accent)" }}>
            下载
          </a>
        ) : null}
      </div>
    </div>
  );
}

function businessFileDownloadUrl(agentId: string, fileName: string) {
  return `/api/claw/business-files/download?agentId=${encodeURIComponent(agentId)}&file=${encodeURIComponent(fileName)}`;
}

function fileTypeFromName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext || ext === name.toLowerCase()) return "文件";
  if (ext === "pptx") return "PPT";
  if (ext === "html") return "HTML";
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "Word";
  if (ext === "xlsx") return "Excel";
  return ext.toUpperCase();
}

function WorkFolderPanel({ agentIds }: { agentIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [filesByAgent, setFilesByAgent] = useState<Record<string, BusinessFile[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentKey = agentIds.join("|");
  const files = agentIds.flatMap((agentId) => (filesByAgent[agentId] || []).map((file) => ({ ...file, agentId })));

  const loadFiles = async () => {
    if (!agentIds.length) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(agentIds.map(async (agentId) => {
        const response = await fetch(`/api/claw/business-files?agentId=${encodeURIComponent(agentId)}`, { credentials: "include" });
        if (!response.ok) throw new Error(`${agentId}: HTTP ${response.status}`);
        const data = await response.json().catch(() => ({}));
        return [agentId, Array.isArray(data.files) ? data.files : []] as const;
      }));
      setFilesByAgent(Object.fromEntries(entries));
    } catch (reason: any) {
      setError(reason?.message || "工作文件夹读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFilesByAgent({});
    setError(null);
    if (open) void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  if (!agentIds.length) return null;

  return (
    <div className="mt-5 rounded-3xl border p-4" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen && !files.length) void loadFiles();
          }}
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-accent)" }}>
            <FolderOpen size={22} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">工作文件夹</span>
            <span className="mt-1 block text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
              查看本次生成后的文件目录，适合找 HTML、PPTX、PDF、Word 等全部产物。
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          {open ? (
            <button
              type="button"
              onClick={() => void loadFiles()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium disabled:opacity-60"
              style={{ background: "var(--oc-muted)", color: "var(--oc-text-primary)" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
              刷新
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const nextOpen = !open;
              setOpen(nextOpen);
              if (nextOpen && !files.length) void loadFiles();
            }}
            className="rounded-full px-4 py-2 text-xs font-medium"
            style={{ background: open ? "var(--oc-accent)" : "var(--oc-muted)", color: open ? "white" : "var(--oc-text-primary)" }}
          >
            {open ? "收起" : "打开"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
              <Loader2 size={15} className="animate-spin" />
              正在读取工作文件夹...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : files.length ? (
            <div className="grid gap-2">
              {files.slice(0, 12).map((file) => (
                <div key={`${file.agentId}-${file.name}`} className="flex items-center gap-3 rounded-2xl px-3 py-2" style={{ background: "var(--oc-bg-soft)" }}>
                  <FileText size={16} className="shrink-0" style={{ color: "var(--oc-text-tertiary)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{file.name}</div>
                    <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                      {file.agentId} {formatSize(file.size)}
                    </div>
                  </div>
                  <a href={businessFileDownloadUrl(file.agentId, file.name)} className="rounded-full px-3 py-1.5 text-xs font-medium text-white" style={{ background: "var(--oc-accent)" }}>
                    下载
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-tertiary)" }}>
              暂时没有读取到文件。若产物刚生成完成，可以稍后点「刷新」。
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type DirectoryItem =
  | {
      key: string;
      kind: "artifact";
      name: string;
      type: string;
      size?: number;
      artifact: Artifact;
      downloadUrl?: string;
      previewable: boolean;
      agentLabel?: string;
    }
  | {
      key: string;
      kind: "business";
      name: string;
      type: string;
      size?: number;
      agentId: string;
      downloadUrl: string;
      previewable: false;
      agentLabel?: string;
    };

function WorkDirectoryContent({ run, agentIds, onPreview, compact = false }: { run: TaskRun | null; agentIds: string[]; onPreview: (artifact: Artifact) => void; compact?: boolean }) {
  const [filesByAgent, setFilesByAgent] = useState<Record<string, BusinessFile[]>>({});
  const [loading, setLoading] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const agentKey = agentIds.join("|");

  const artifactItems = useMemo<DirectoryItem[]>(() => {
    if (!run) return [];
    const items: DirectoryItem[] = [];
    const seen = new Set<string>();
    const pushArtifact = (artifact: Artifact, stage?: TaskStageResult) => {
      const key = `artifact:${artifact.id || artifact.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        key,
        kind: "artifact",
        name: artifact.name,
        type: artifact.type || fileTypeFromName(artifact.name),
        size: artifactSize(artifact),
        artifact,
        downloadUrl: artifact.downloadUrl,
        previewable: Boolean(artifact.previewUrl),
        agentLabel: stage ? personaShortLabel(stage.personaId) : "任务产物",
      });
    };
    for (const stage of run.stages || []) {
      for (const artifact of stage.artifacts || stage.runResult?.artifacts || []) {
        pushArtifact(artifact, stage);
      }
    }
    for (const artifact of run.artifacts || []) pushArtifact(artifact);
    return items;
  }, [run]);

  const businessItems = useMemo<DirectoryItem[]>(() => {
    return agentIds.flatMap((agentId) => (filesByAgent[agentId] || []).map((file) => ({
      key: `business:${agentId}:${file.name}`,
      kind: "business" as const,
      name: file.name,
      type: fileTypeFromName(file.name),
      size: file.size,
      agentId,
      downloadUrl: businessFileDownloadUrl(agentId, file.name),
      previewable: false as const,
      agentLabel: agentId,
    })));
  }, [agentIds, filesByAgent]);

  const visibleItems = [...artifactItems, ...businessItems].filter((item) => !hiddenKeys.has(item.key));

  const loadFiles = async () => {
    if (!agentIds.length) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(agentIds.map(async (agentId) => {
        const response = await fetch(`/api/claw/business-files?agentId=${encodeURIComponent(agentId)}`, { credentials: "include" });
        if (!response.ok) throw new Error(`${agentId}: HTTP ${response.status}`);
        const data = await response.json().catch(() => ({}));
        return [agentId, Array.isArray(data.files) ? data.files : []] as const;
      }));
      setFilesByAgent(Object.fromEntries(entries));
    } catch (reason: any) {
      setError(reason?.message || "工作目录读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFilesByAgent({});
    setHiddenKeys(new Set());
    setError(null);
    if (run && agentIds.length) void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.taskRunId, agentKey]);

  return (
      <div className={compact ? "rounded-2xl border p-3" : "rounded-3xl border p-4"} style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
        {!run ? (
          <div className="flex items-start gap-3 text-xs leading-5" style={{ color: "var(--oc-text-tertiary)" }}>
            <FolderOpen size={16} className="mt-0.5 shrink-0" />
            <span>任务完成后，PPT、HTML、PDF、Word 等文件会出现在这里。</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        ) : visibleItems.length ? (
          <div className="space-y-2">
            {visibleItems.slice(0, compact ? 10 : 80).map((item) => (
              <div key={item.key} className="rounded-xl px-2.5 py-2" style={{ background: "var(--oc-bg-soft)" }}>
                <div className="flex items-start gap-2">
                  <FileText size={15} className="mt-0.5 shrink-0" style={{ color: "var(--oc-text-tertiary)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium" title={item.name}>{item.name}</div>
                    <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                      {item.type} {formatSize(item.size)} {item.agentLabel ? `· ${item.agentLabel}` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 pl-6">
                  {item.kind === "artifact" && item.previewable ? (
                    <button type="button" onClick={() => onPreview(item.artifact)} className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: "var(--oc-card)", color: "var(--oc-text-primary)" }}>
                      预览
                    </button>
                  ) : null}
                  {item.downloadUrl ? (
                    <a href={item.downloadUrl} className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white" style={{ background: "var(--oc-accent)" }}>
                      下载
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setHiddenKeys((current) => new Set([...current, item.key]))}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ background: "var(--oc-card)", color: "var(--oc-text-tertiary)" }}
                    title="从当前工作台隐藏，审计记录仍保留"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {compact && visibleItems.length > 10 ? (
              <div className="px-2 text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                还有 {visibleItems.length - 10} 个文件，后续接完整目录页。
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            {loading ? "正在读取文件..." : "暂时没有文件。"}
          </div>
        )}
      </div>
  );
}

function SidebarWorkDirectory({ run, agentIds, onPreview }: { run: TaskRun | null; agentIds: string[]; onPreview: (artifact: Artifact) => void }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between px-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: "var(--oc-text-tertiary)" }}>
          工作目录
        </div>
      </div>
      <WorkDirectoryContent run={run} agentIds={agentIds} onPreview={onPreview} compact />
    </section>
  );
}

function WorkDirectorySidePanel({ run, preview, onClose, onPreview }: { run: TaskRun | null; preview: WorkDirectoryPreviewState; onClose: () => void; onPreview: (artifact: Artifact) => void }) {
  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden w-[42vw] min-w-[480px] border-l bg-white shadow-2xl xl:flex xl:flex-col" style={{ borderColor: "var(--oc-border)" }}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: "var(--oc-border)" }}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">工作目录</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            当前任务产物 + 各 Agent 工作文件夹
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <WorkDirectoryContent run={run} agentIds={preview.agentIds} onPreview={onPreview} />
      </div>
    </aside>
  );
}

function PreviewSidePanel({ preview, onClose, onFullscreen }: { preview: PreviewState; onClose: () => void; onFullscreen: () => void }) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewHtml(null);
    setPreviewError(null);
    fetch(preview.previewUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        if (cancelled) return;
        setPreviewHtml(html.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, ""));
      })
      .catch((error: Error) => {
        if (!cancelled) setPreviewError(error.message || "preview_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [preview.previewUrl]);

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden w-[48vw] min-w-[560px] border-l bg-white shadow-2xl xl:flex xl:flex-col" style={{ borderColor: "var(--oc-border)" }}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: "var(--oc-border)" }}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{preview.fileName}</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>右侧统一预览</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onFullscreen} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="全屏预览">
            <Maximize2 size={16} />
          </button>
          <a href={preview.downloadUrl} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="下载">
            <Download size={16} />
          </a>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="关闭预览">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {previewHtml ? (
          <iframe title={preview.fileName} srcDoc={previewHtml} sandbox="allow-scripts" className="absolute inset-0 h-full w-full border-0" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--oc-text-tertiary)" }}>
            {previewError ? `预览加载失败：${previewError}` : "正在加载预览..."}
          </div>
        )}
      </div>
    </aside>
  );
}

function ResearchSourceSidePanel({ preview, onClose }: { preview: ResearchPreviewState; onClose: () => void }) {
  const sourceResearch = (preview.metadata.sourceResearch || {}) as any;
  const plan = sourceResearch.searchPlan || {};
  const sources = asArray(sourceResearch.sources);
  const discarded = asArray(sourceResearch.discardedSources);
  const queries = asArray(plan.queries).map((item) => String(item)).filter(Boolean);
  const fallbackQueries = asArray(plan.sourceHunt?.fallbackQueries).map((item) => String(item)).filter(Boolean);

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden w-[48vw] min-w-[560px] border-l bg-white shadow-2xl xl:flex xl:flex-col" style={{ borderColor: "var(--oc-border)" }}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: "var(--oc-border)" }}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{preview.title} · 资料来源</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            {confidenceLabel(sourceResearch.confidence)} · {sources.length} 条采用 · {discarded.length} 条过滤
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section className="rounded-2xl border p-4" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>检索规划</div>
          {plan.rationale ? <p className="mt-2 text-xs leading-6" style={{ color: "var(--oc-text-secondary)" }}>{String(plan.rationale)}</p> : null}
          {plan.sourceHunt?.rationale ? <p className="mt-2 text-xs leading-6" style={{ color: "var(--oc-text-secondary)" }}>{String(plan.sourceHunt.rationale)}</p> : null}
          <div className="mt-3 space-y-1">
            {[...queries, ...fallbackQueries].slice(0, 20).map((query, index) => (
              <div key={`${query}-${index}`} className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5" style={{ color: "var(--oc-text-secondary)" }}>
                <span className="mr-2 font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{String(index + 1).padStart(2, "0")}</span>
                {query}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 space-y-2">
          <div className="text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>采用来源</div>
          {sources.map((source) => (
            <a
              key={source.sourceId || source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl border p-4 text-xs leading-6 transition hover:-translate-y-0.5"
              style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)", color: "var(--oc-text-secondary)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{source.sourceId || "src"}</span>
                <span className="rounded-full px-2 py-0.5" style={{ background: "var(--oc-muted)", color: "var(--oc-text-primary)" }}>{sourceRoleLabel(source.evidenceRole)}</span>
                <span>{source.publisherClass || "unknown"}</span>
                {source.sourceScore?.finalScore != null ? <span>score {source.sourceScore.finalScore}</span> : null}
              </div>
              <div className="mt-2 text-sm font-semibold leading-6" style={{ color: "var(--oc-text-primary)" }}>{source.title}</div>
              {source.snippet ? <div className="mt-2 line-clamp-4">{source.snippet}</div> : null}
              <div className="mt-2 truncate" style={{ color: "var(--oc-text-tertiary)" }}>{source.url}</div>
            </a>
          ))}
        </section>

        {discarded.length ? (
          <section className="mt-5 space-y-2">
            <div className="text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>过滤来源</div>
            {discarded.slice(0, 40).map((source) => (
              <div key={source.url} className="rounded-2xl border px-4 py-3 text-xs leading-6" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
                <div className="font-medium" style={{ color: "var(--oc-text-primary)" }}>{source.title}</div>
                <div className="mt-1">{source.discardReason || source.qualityReason || "未采用"}</div>
                <div className="mt-1 truncate" style={{ color: "var(--oc-text-tertiary)" }}>{source.url}</div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function UserTaskCard({ prompt, attachments }: { prompt: string; attachments: string[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-3xl rounded-[28px] px-5 py-4 shadow-sm" style={{ background: "var(--oc-accent)", color: "white" }}>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium opacity-80">
          <UserRound size={14} />
          你发起了任务
        </div>
        <div className="whitespace-pre-wrap text-sm leading-7">{prompt}</div>
        {attachments.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((name) => (
              <span key={name} className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs">
                <Paperclip size={13} />
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RouterDecisionCard({ routing, decision }: { routing: boolean; decision: RouterDecision | null }) {
  if (!routing && !decision) return null;
  const isRun = decision?.intent === "run_template";
  const isClarify = decision?.intent === "clarify";
  const isUnsupported = decision?.intent === "unsupported";
  const title = routing
    ? "正在判断是否启动任务"
    : isRun
      ? "已识别为任务请求"
      : isClarify
        ? "需要补充一点信息"
        : isUnsupported
          ? "这个请求不会自动执行"
          : "任务工作台";
  const body = routing
    ? "我先判断这句话是闲聊、补充信息，还是需要启动专员链路。"
    : decision?.reply || decision?.clarifyingQuestion || decision?.normalizedGoal || "";

  return (
    <div className="mt-5 flex justify-start">
      <div
        className="max-w-3xl rounded-[28px] border bg-white px-5 py-4 shadow-sm"
        style={{ borderColor: isUnsupported ? "rgba(220,38,38,0.22)" : "var(--oc-border)" }}
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: isUnsupported ? "#b91c1c" : "var(--oc-text-primary)" }}>
          {routing ? <Loader2 className="h-4 w-4 animate-spin" /> : isUnsupported ? <AlertTriangle size={16} /> : <Sparkles size={16} style={{ color: "var(--oc-accent)" }} />}
          {title}
        </div>
        {body ? (
          <div className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--oc-text-secondary)" }}>
            {body}
          </div>
        ) : null}
        {isRun && decision?.userVisiblePlan?.length ? (
          <div className="mt-3 grid gap-2">
            {decision.userVisiblePlan.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: "var(--oc-accent)" }}>
                  {index + 1}
                </span>
                {item}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RunningStageCard({ stage, index }: { stage: TaskTemplate["stages"][number]; index: number }) {
  const steps = PERSONA_STEPS[stage.personaId] || ["理解任务", "执行分析", "整理结果"];
  const isFirst = index === 0;
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: isFirst ? "var(--oc-accent)" : "#475569" }}>
          {personaInitial(stage.personaId)}
        </div>
        <div className="mt-2 h-full min-h-14 w-px" style={{ background: "var(--oc-border)" }} />
      </div>
      <div className="mb-4 flex-1 rounded-3xl border p-4" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{personaLabel(stage)}</div>
            <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
              {stage.displayName}
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: "color-mix(in oklab, var(--oc-accent) 10%, transparent)", color: "var(--oc-accent)" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在执行
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((item, stepIndex) => (
            <div key={item} className="rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: "var(--oc-border)", background: stepIndex === 0 ? "color-mix(in oklab, var(--oc-accent) 7%, var(--oc-card))" : "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
              {stepIndex === 0 ? "进行中 · " : "等待 · "}
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceSearchPlanCard({ metadata }: { metadata?: Record<string, unknown> }) {
  const sourceResearch = (metadata?.sourceResearch || null) as any;
  const plan = sourceResearch?.searchPlan;
  if (!plan) return null;
  const queries: string[] = Array.isArray(plan.queries) ? plan.queries.map((item: unknown) => String(item)).filter(Boolean).slice(0, 8) : [];
  const hints: string[] = Array.isArray(plan.officialSourceHints) ? plan.officialSourceHints.map((item: unknown) => String(item)).filter(Boolean).slice(0, 6) : [];
  const normalized = plan.normalizedQuery?.canonicalQuery || sourceResearch?.normalizedQuery?.canonicalQuery;
  const planner = plan.planner || {};
  const plannerLabel = planner.mode === "lingxia-llm"
    ? `LLM 搜索规划${planner.provider ? ` · ${planner.provider}` : ""}${planner.model ? ` · ${planner.model}` : ""}`
    : "规则搜索规划";

  return (
    <details className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)" }} open>
      <summary className="cursor-pointer select-none text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>
        搜索规划 · {plannerLabel}
      </summary>
      <div className="mt-3 space-y-3 text-xs leading-6" style={{ color: "var(--oc-text-secondary)" }}>
        {plan.rationale ? <div>{String(plan.rationale)}</div> : null}
        {normalized ? (
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span className="font-medium" style={{ color: "var(--oc-text-primary)" }}>聚焦问题：</span>
            {String(normalized)}
          </div>
        ) : null}
        {hints.length ? (
          <div className="flex flex-wrap gap-2">
            {hints.map((hint) => (
              <span key={hint} className="rounded-full bg-white/80 px-2.5 py-1">
                官方/一手源：{hint}
              </span>
            ))}
          </div>
        ) : null}
        {queries.length ? (
          <ol className="space-y-1">
            {queries.map((query, index) => (
              <li key={`${query}-${index}`} className="rounded-xl bg-white/70 px-3 py-1.5">
                <span className="mr-2 font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{String(index + 1).padStart(2, "0")}</span>
                {query}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </details>
  );
}

function sourceRoleLabel(role?: string) {
  return {
    source_of_record: "一手依据",
    corroboration: "交叉佐证",
    context: "背景材料",
    commentary: "观点参考",
  }[role || ""] || role || "未分级";
}

function confidenceLabel(confidence?: string) {
  return {
    high: "高置信",
    medium: "中置信",
    low: "低置信",
  }[confidence || ""] || "待评估";
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function SourceResearchSummaryCard({ metadata, onOpenDetails }: { metadata?: Record<string, unknown>; onOpenDetails: (metadata: Record<string, unknown>) => void }) {
  const sourceResearch = (metadata?.sourceResearch || null) as any;
  const plan = sourceResearch?.searchPlan;
  if (!sourceResearch || !plan) return null;
  const queries = asArray(plan.queries).map((item) => String(item)).filter(Boolean);
  const sourceHunt = plan.sourceHunt || {};
  const sources = asArray(sourceResearch.sources);
  const discarded = asArray(sourceResearch.discardedSources);
  const summary = sourceResearch.evidenceSummary || {};
  const normalized = plan.normalizedQuery?.canonicalQuery || sourceResearch?.normalizedQuery?.canonicalQuery;
  const planner = plan.planner || {};
  const plannerLabel = planner.mode === "lingxia-llm"
    ? `LLM 搜索规划${planner.provider ? ` · ${planner.provider}` : ""}${planner.model ? ` · ${planner.model}` : ""}`
    : "规则搜索规划";
  const topSources = sources.slice(0, 3);

  return (
    <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>
            资料检索概览 · {confidenceLabel(sourceResearch.confidence)}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            {plannerLabel} · {sourceHunt.type ? `Source Hunt: ${sourceHunt.type}` : "开放检索"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenDetails(metadata || {})}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: "var(--oc-card)", color: "var(--oc-text-primary)", border: "1px solid var(--oc-border)" }}
        >
          查看全部来源
        </button>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5" style={{ color: "var(--oc-text-secondary)" }}>
        <div className="rounded-xl bg-white/70 px-3 py-2">一手 {summary.sourceOfRecordCount || 0}</div>
        <div className="rounded-xl bg-white/70 px-3 py-2">佐证 {summary.corroborationCount || 0}</div>
        <div className="rounded-xl bg-white/70 px-3 py-2">背景 {summary.contextCount || 0}</div>
        <div className="rounded-xl bg-white/70 px-3 py-2">参考 {summary.commentaryCount || 0}</div>
        <div className="rounded-xl bg-white/70 px-3 py-2">过滤 {discarded.length || summary.discardedCount || 0}</div>
      </div>

      <div className="mt-3 space-y-3 text-xs leading-6" style={{ color: "var(--oc-text-secondary)" }}>
        {normalized ? (
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span className="font-medium" style={{ color: "var(--oc-text-primary)" }}>聚焦问题：</span>
            {String(normalized)}
          </div>
        ) : null}
        {topSources.length ? (
          <div className="space-y-1">
            {topSources.map((source) => (
              <div key={source.sourceId || source.url} className="rounded-xl bg-white/70 px-3 py-2">
                <span className="mr-2 font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{source.sourceId || "src"}</span>
                <span className="font-medium" style={{ color: "var(--oc-text-primary)" }}>{sourceRoleLabel(source.evidenceRole)}</span>
                <span className="mx-2">·</span>
                <span>{source.title}</span>
              </div>
            ))}
          </div>
        ) : null}
        {queries.length ? <div style={{ color: "var(--oc-text-tertiary)" }}>已规划 {queries.length} 条检索；完整 query、来源分层和过滤原因请在右侧详情查看。</div> : null}
      </div>
    </div>
  );
}

function LiveStageCard({ stage, onPreview, onOpenResearch }: { stage: LiveStageState; onPreview: (artifact: Artifact) => void; onOpenResearch: (title: string, metadata: Record<string, unknown>) => void }) {
  const meta = statusMeta(stage.status);
  const Icon = meta.icon;
  const hasArtifacts = Boolean(stage.artifacts?.length);
  const text = cleanText(stage.text);
  const hasSourceResearch = Boolean(stage.runResult?.metadata?.sourceResearch);
  const preview = stage.status === "running" ? text.slice(0, 420) : "";
  const finalText = stage.status !== "running" && !hasSourceResearch ? text : "";
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <PersonaAvatar personaId={stage.personaId} failed={stage.status === "failed" || stage.status === "timeout"} />
        <div className="mt-2 h-full min-h-14 w-px" style={{ background: "var(--oc-border)" }} />
      </div>
      <div className="mb-6 flex-1">
        <div className="rounded-3xl border p-5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{personaLabel(stage)}</div>
              <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                {stage.displayName || stage.agentDefinitionId} {stage.durationMs ? `· ${formatDuration(stage.durationMs)}` : ""}
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: "var(--oc-muted)", color: meta.color }}>
              <Icon size={14} className={stage.status === "running" ? "animate-spin" : undefined} />
              {meta.label}
            </span>
          </div>

          {stage.events.length ? (
            <details className="mt-3 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)" }} open={stage.status === "running"}>
              <summary className="cursor-pointer select-none text-xs font-medium" style={{ color: "var(--oc-text-secondary)" }}>
                执行轨迹 · {stage.events.length} 条
              </summary>
              <div className="mt-2 space-y-1">
              {stage.events.map((event, index) => (
                <div key={`${event}-${index}`} className="flex items-start gap-2 rounded-xl bg-white/70 px-2.5 py-1.5 text-[11px] leading-5" style={{ color: "var(--oc-text-secondary)" }}>
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: stage.status === "running" ? "var(--oc-accent)" : "var(--oc-text-tertiary)" }} />
                  <span className="min-w-0">{event}</span>
                </div>
              ))}
              </div>
            </details>
          ) : (
            <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-tertiary)" }}>
              {stage.status === "waiting" ? "等待上游专员完成..." : "正在启动专员..."}
            </div>
          )}

          <SourceResearchSummaryCard
            metadata={stage.runResult?.metadata}
            onOpenDetails={(metadata) => onOpenResearch(personaLabel(stage), metadata)}
          />

          {preview ? (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm leading-7" style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-secondary)" }}>
              <div className="whitespace-pre-wrap">{preview}</div>
            </div>
          ) : null}

          {hasArtifacts && stage.status !== "running" ? (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm leading-6" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
              已生成交付文件。点击文件卡的「预览」会在右侧打开，过程区只保留执行轨迹，避免和最终产物重复。
            </div>
          ) : null}

          {stage.artifacts?.length ? (
            <div className="mt-3 grid gap-3">
              {stage.artifacts.map((artifact) => (
                <CompactArtifactCard key={artifact.id} artifact={artifact} onPreview={onPreview} />
              ))}
            </div>
          ) : null}

          {stage.error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{stage.error}</div>
          ) : null}
        </div>

        {finalText ? (
          <article className="mt-6 max-w-none px-1 pb-2">
            <MarkdownContent text={finalText} />
          </article>
        ) : null}
      </div>
    </div>
  );
}

function AgentMessageCard({ stage, artifacts, onPreview, onOpenResearch }: { stage: TaskStageResult; artifacts: Artifact[]; onPreview: (artifact: Artifact) => void; onOpenResearch: (title: string, metadata: Record<string, unknown>) => void }) {
  const meta = statusMeta(stage.status);
  const Icon = meta.icon;
  const hasSourceResearch = Boolean(stage.runResult?.metadata?.sourceResearch);
  const output = hasSourceResearch ? "" : cleanText(stage.runResult?.output || stage.runResult?.summary || "");
  const errorText = stage.runResult?.error?.detail || stage.runResult?.error?.code;

  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <PersonaAvatar personaId={stage.personaId} failed={stage.status !== "success"} />
        <div className="mt-2 h-full min-h-14 w-px" style={{ background: "var(--oc-border)" }} />
      </div>
      <div className="mb-6 flex-1">
        <div className="rounded-3xl border p-5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{personaLabel(stage)}</div>
              <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                {stage.agentDefinitionId} · {formatDuration(stage.durationMs)}
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: "var(--oc-muted)", color: meta.color }}>
              <Icon size={14} className={stage.status === "success" ? "" : undefined} />
              {meta.label}
            </span>
          </div>

          {!output && errorText ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{errorText}</div>
          ) : !output ? (
            <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-tertiary)" }}>
              这个专员没有返回文字说明，但可能已经生成了产物。
            </div>
          ) : null}

          {stage.warnings?.length ? (
            <div className="mt-3 space-y-2">
              {stage.warnings.map((warning) => (
                <div key={warning} className="rounded-2xl border px-4 py-2 text-xs" style={{ borderColor: "rgba(180,83,9,0.28)", background: "rgba(245,158,11,0.08)", color: "#92400e" }}>
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          <SourceResearchSummaryCard
            metadata={stage.runResult?.metadata}
            onOpenDetails={(metadata) => onOpenResearch(personaLabel(stage), metadata)}
          />

          {artifacts.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {artifacts.map((artifact) => (
                <CompactArtifactCard key={artifact.id} artifact={artifact} onPreview={onPreview} />
              ))}
            </div>
          ) : null}
        </div>

        {output ? (
          <article className="mt-6 max-w-none px-1 pb-2">
            <MarkdownContent text={output} />
          </article>
        ) : null}
      </div>
    </div>
  );
}

function TaskSelector({
  templates,
  selectedId,
  loading,
  error,
  running,
  run,
  workFolderAgentIds,
  onChoose,
  onPreview,
}: {
  templates: TaskTemplate[];
  selectedId: string;
  loading: boolean;
  error: string | null;
  running: boolean;
  run: TaskRun | null;
  workFolderAgentIds: string[];
  onChoose: (template: TaskTemplate) => void;
  onPreview: (artifact: Artifact) => void;
}) {
  const personaIds = Array.from(new Set(templates.flatMap((template) => template.stages.map((stage) => stage.personaId))));
  const [tasksOpen, setTasksOpen] = useState(true);
  const [personasOpen, setPersonasOpen] = useState(true);
  return (
    <aside className="hidden w-72 shrink-0 border-r px-4 py-5 lg:block" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg-soft)" }}>
      <div className="mb-5 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl text-white" style={{ background: "var(--oc-accent)" }}>
          <Sparkles size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold">任务工作台</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>灰度验证页</div>
        </div>
      </div>

      <section>
        <button
          type="button"
          onClick={() => setTasksOpen((open) => !open)}
          className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-medium uppercase tracking-[0.18em]"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          <span>预制任务</span>
          <ChevronDown size={14} className={`transition ${tasksOpen ? "rotate-0" : "-rotate-90"}`} />
        </button>

        {tasksOpen ? (
          loading ? (
            <div className="flex items-center gap-2 px-2 py-8 text-sm" style={{ color: "var(--oc-text-tertiary)" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              加载任务模板...
            </div>
          ) : error && templates.length === 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => {
                const Icon = TASK_ICONS[template.id] || FileText;
                const active = selectedId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    disabled={running}
                    onClick={() => onChoose(template)}
                    className="w-full rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70"
                    style={{
                      borderColor: active ? "color-mix(in oklab, var(--oc-accent) 45%, var(--oc-border))" : "transparent",
                      background: active ? "var(--oc-card)" : "transparent",
                      boxShadow: active ? "0 12px 28px rgba(15,23,42,0.08)" : "none",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: active ? "color-mix(in oklab, var(--oc-accent) 12%, transparent)" : "var(--oc-muted)", color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-medium">{template.displayName}</div>
                          {active ? (
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in oklab, var(--oc-accent) 12%, transparent)", color: "var(--oc-accent)" }}>
                              已选择
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                          预计 {formatDuration(template.estimatedDurationMs)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-5" style={{ color: "var(--oc-text-tertiary)" }}>
                          {template.shortDescription}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : null}
      </section>

      {personaIds.length ? (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setPersonasOpen((open) => !open)}
            className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-medium uppercase tracking-[0.18em]"
            style={{ color: "var(--oc-text-tertiary)" }}
          >
            <span>智能体专员</span>
            <ChevronDown size={14} className={`transition ${personasOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {personasOpen ? (
            <div className="space-y-2">
              {personaIds.map((personaId) => (
                <div key={personaId} className="rounded-2xl border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
                  <div className="flex items-start gap-3">
                    <PersonaAvatar personaId={personaId} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{personaLabel({ personaId })}</div>
                      <div className="mt-1 text-[11px] leading-5" style={{ color: "var(--oc-text-tertiary)" }}>
                        {PERSONA_DESCRIPTIONS[personaId] || "参与任务执行的智能体专员。"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

    </aside>
  );
}

export default function TaskWorkbenchLab() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [submittedAttachments, setSubmittedAttachments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routerDecision, setRouterDecision] = useState<RouterDecision | null>(null);
  const [run, setRun] = useState<TaskRun | null>(null);
  const [liveStages, setLiveStages] = useState<LiveStageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [researchPreview, setResearchPreview] = useState<ResearchPreviewState | null>(null);
  const [workDirectoryPreview, setWorkDirectoryPreview] = useState<WorkDirectoryPreviewState | null>(null);
  const [fullscreenPreview, setFullscreenPreview] = useState<PreviewState | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const selected = useMemo(() => templates.find((item) => item.id === selectedId) || null, [templates, selectedId]);
  const hasConversation = Boolean(submittedPrompt || routing || running || routerDecision || run);
  const workFolderAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const stage of run?.stages || []) {
      if (/^task-/.test(stage.agentDefinitionId)) ids.add(stage.agentDefinitionId);
    }
    return Array.from(ids);
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/task-workbench-lab/templates", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status === 404 ? "Task Workbench Lab 未开启" : `HTTP ${response.status}`))))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.templates) ? data.templates : [];
        setTemplates(rows);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message || "模板加载失败");
          toast.error(reason.message || "模板加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 10 + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, hasConversation]);

  const isNearBottom = () => {
    if (typeof window === "undefined") return true;
    const doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 180;
  };

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    programmaticScrollRef.current = true;
    conversationEndRef.current?.scrollIntoView({ block: "end", behavior });
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
      lastScrollYRef.current = window.scrollY;
    }, behavior === "smooth" ? 450 : 80);
  };

  useEffect(() => {
    if (!hasConversation) return;
    lastScrollYRef.current = window.scrollY;
    const cancelAutoScroll = () => {
      if (!isNearBottom()) {
        setAutoScrollEnabled(false);
        setShowJumpToLatest(true);
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < -6) cancelAutoScroll();
    };
    const onScroll = () => {
      const currentY = window.scrollY;
      if (isNearBottom()) {
        setAutoScrollEnabled(true);
        setShowJumpToLatest(false);
      } else if (!programmaticScrollRef.current && currentY < lastScrollYRef.current - 8) {
        cancelAutoScroll();
      }
      lastScrollYRef.current = currentY;
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [hasConversation]);

  useEffect(() => {
    if (!hasConversation) return;
    if (!autoScrollEnabled) {
      if (!isNearBottom()) setShowJumpToLatest(true);
      return;
    }
    scrollToLatest(running ? "smooth" : "auto");
  }, [hasConversation, running, liveStages, run, error, autoScrollEnabled]);

  const chooseTemplate = (template: TaskTemplate) => {
    if (running || routing) return;
    if (selectedId === template.id) {
      clearTemplateMode();
      return;
    }
    setSelectedId(template.id);
    setPrompt("");
    setAttachments([]);
    setAutoScrollEnabled(true);
    setShowJumpToLatest(false);
    setSubmittedPrompt("");
    setSubmittedAttachments([]);
    setRouterDecision(null);
    setRun(null);
    setLiveStages([]);
    setError(null);
  };

  const clearTemplateMode = () => {
    if (running || routing) return;
    setSelectedId("");
    setAutoScrollEnabled(true);
    setShowJumpToLatest(false);
  };

  const handleAttachmentPick = (files: FileList | null) => {
    if (!files?.length) return;
    setAttachments((current) => Array.from(new Set([...current, ...Array.from(files).map((file) => file.name)])));
    toast.info("附件入口已记录文件名，内容传入会在下一步接入。");
  };

  const removeAttachment = (name: string) => {
    setAttachments((current) => current.filter((item) => item !== name));
  };

  const runTask = async () => {
    if (!selected || !prompt.trim() || running) return;
    const finalPrompt = prompt.trim();
    setSubmittedPrompt(finalPrompt);
    setSubmittedAttachments(attachments);
    setPrompt("");
    setAttachments([]);
    setAutoScrollEnabled(true);
    setShowJumpToLatest(false);
    setRunning(true);
    setRun(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/task-workbench-lab/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskTemplateId: selected.id, prompt: finalPrompt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
      }
      setRun(data.taskRun);
      toast.success(`任务完成：${statusMeta(data.taskRun?.status || "").label}`);
    } catch (reason: any) {
      const message = reason?.message || "任务运行失败";
      setError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const runTaskStream = async () => {
    if (!prompt.trim() || running || routing) return;
    const finalPrompt = prompt.trim();
    setSubmittedPrompt(finalPrompt);
    setSubmittedAttachments(attachments);
    setPrompt("");
    setAttachments([]);
    setAutoScrollEnabled(true);
    setShowJumpToLatest(false);
    setRouting(true);
    setRunning(false);
    setRun(null);
    setLiveStages([]);
    setRouterDecision(null);
    setError(null);
    try {
      const routeResponse = await fetch("/api/admin/task-workbench-lab/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskTemplateId: selected?.id, prompt: finalPrompt }),
      });
      const routeData = await routeResponse.json().catch(() => ({}));
      if (!routeResponse.ok) {
        throw new Error(routeData?.detail || routeData?.error || `HTTP ${routeResponse.status}`);
      }
      const decision = routeData?.decision as RouterDecision | undefined;
      if (!decision?.intent) throw new Error("router_decision_missing");
      setRouterDecision(decision);
      setRouting(false);

      if (decision.intent !== "run_template") {
        if (decision.intent === "clarify") toast.info("需要再确认一下交付目标。");
        if (decision.intent === "unsupported") toast.warning("这个请求不会自动执行。");
        return;
      }

      const taskTemplateId = decision.selectedTemplateId || selected?.id;
      if (!taskTemplateId) throw new Error("router_did_not_select_template");
      const templateToRun = templates.find((item) => item.id === taskTemplateId);
      if (!templateToRun) throw new Error(`template_not_loaded: ${taskTemplateId}`);
      if (taskTemplateId !== selectedId) setSelectedId(taskTemplateId);
      const streamPrompt = decision.normalizedGoal || finalPrompt;
      setRunning(true);
      setLiveStages(templateToRun.stages.map((stage) => ({
        stageId: stage.id,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        displayName: stage.displayName,
        status: "waiting",
        events: [],
        text: "",
      })));

      const response = await fetch("/api/admin/task-workbench-lab/run-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskTemplateId, prompt: streamPrompt }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("stream_not_available");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedRun: TaskRun | null = null;

      const applyPayload = (payload: StreamPayload) => {
        if (payload.type === "stage_started" && payload.event) {
          const event = payload.event;
          setLiveStages((current) => current.map((stage) => stage.stageId === event.stageId
            ? {
              ...stage,
              status: "running",
              startedAt: Date.now(),
              events: appendLimited(stage.events, `${event.displayName || stage.displayName} 已开始`),
            }
            : stage));
          return;
        }
        if (payload.type === "stage_retry" && payload.event) {
          const event = payload.event;
          setLiveStages((current) => current.map((stage) => stage.stageId === event.stageId
            ? { ...stage, status: "running", events: appendLimited(stage.events, `重试：${event.reason || "上次执行未成功"}`) }
            : stage));
          return;
        }
        if (payload.type === "agent_event" && payload.event) {
          const event = payload.event;
          setLiveStages((current) => current.map((stage) => stage.agentDefinitionId === event.agentDefinitionId
            ? (() => {
              const progressMessage = event.type === "progress" || event.type === "artifact_hint"
                ? normalizeProgressMessage(event.message || (event.type === "artifact_hint" ? "整理交付文件" : "正在生成内容"))
                : "";
              return {
                ...stage,
                status: stage.status === "waiting" ? "running" : stage.status,
                events: progressMessage ? appendLimited(stage.events, progressMessage) : stage.events,
                text: event.type === "text_delta" ? `${stage.text}${event.text || ""}` : stage.text,
                error: event.type === "error" ? event.message : stage.error,
              };
            })()
            : stage));
          return;
        }
        if (payload.type === "stage_done" && payload.event?.stage) {
          const done = payload.event.stage as TaskStageResult;
          setLiveStages((current) => current.map((stage) => stage.stageId === done.stageId
            ? {
              ...stage,
              status: done.status === "success" ? "success" : done.status === "timeout" ? "timeout" : "failed",
              durationMs: done.durationMs,
              artifacts: done.artifacts,
              runResult: done.runResult,
              error: done.runResult?.error?.detail,
              text: stage.text || done.runResult?.output || done.runResult?.summary || "",
              events: appendLimited(stage.events, done.status === "success" ? "阶段完成" : `阶段未完成：${done.runResult?.error?.detail || done.status}`),
            }
            : stage));
          return;
        }
        if (payload.type === "run_done" && payload.taskRun) {
          completedRun = payload.taskRun;
          setRun(payload.taskRun);
          setLiveStages((current) => current.map((stage) => {
            const finalStage = payload.taskRun?.stages?.find((item) => item.stageId === stage.stageId);
            if (!finalStage) return stage;
            return {
              ...stage,
              status: finalStage.status === "success" ? "success" : finalStage.status === "timeout" ? "timeout" : "failed",
              durationMs: finalStage.durationMs,
              artifacts: finalStage.artifacts,
              runResult: finalStage.runResult,
              error: finalStage.runResult?.error?.detail,
              text: finalStage.runResult?.output || finalStage.runResult?.summary || stage.text,
            };
          }));
          return;
        }
        if (payload.type === "run_failed") {
          throw new Error(payload.error?.detail || payload.error?.kind || "任务运行失败");
        }
      };

      const consumeBlock = (block: string) => {
        const dataLines = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (!dataLines.length) return;
        const data = dataLines.join("\n");
        if (!data || data === "[DONE]") return;
        applyPayload(JSON.parse(data));
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() || "";
        for (const part of parts) consumeBlock(part);
        if (done) break;
      }
      if (buffer.trim()) consumeBlock(buffer);
      const finalRun = completedRun as TaskRun | null;
      if (!finalRun) throw new Error("stream_finished_without_result");
      toast.success(`任务完成，${statusMeta(finalRun.status).label}`);
    } catch (reason: any) {
      const message = reason?.message || "任务运行失败";
      setError(message);
      toast.error(message);
    } finally {
      setRouting(false);
      setRunning(false);
    }
  };

  const openPreview = (artifact: Artifact) => {
    if (!artifact.previewUrl) return;
    const nextPreview = {
      previewUrl: artifact.previewUrl,
      downloadUrl: artifact.downloadUrl || artifact.previewUrl,
      fileName: artifact.name,
    };
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setFullscreenPreview(nextPreview);
      return;
    }
    setResearchPreview(null);
    setWorkDirectoryPreview(null);
    setPreview(nextPreview);
  };

  const openResearchPreview = (title: string, metadata: Record<string, unknown>) => {
    setPreview(null);
    setWorkDirectoryPreview(null);
    setResearchPreview({ title, metadata });
  };

  const openWorkDirectory = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      toast.info("工作目录已在左侧/任务完成后显示，移动端弹窗下一步接入。");
      return;
    }
    setPreview(null);
    setResearchPreview(null);
    setWorkDirectoryPreview({ agentIds: workFolderAgentIds });
  };

  const composer = (
    <div className="pointer-events-auto rounded-[18px] border bg-white/95 px-3 py-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl" style={{ borderColor: "var(--oc-border)" }}>
      {selected ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2" style={{ background: "var(--oc-bg-soft)" }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "color-mix(in oklab, var(--oc-accent) 12%, transparent)", color: "var(--oc-accent)" }}>
                已选择任务
              </span>
              <span className="truncate" style={{ color: "var(--oc-text-primary)" }}>{selected.displayName}</span>
            </div>
            <div className="mt-1 truncate text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
              {selected.stages.map((stage) => personaShortLabel(stage.personaId).split("·")[0].trim()).join(" → ")}
            </div>
          </div>
          <button
            type="button"
            onClick={clearTemplateMode}
            disabled={running || routing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: "var(--oc-text-secondary)" }}
            title="退出任务模式"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {attachments.map((name) => (
            <span key={name} className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
              <Paperclip size={13} />
              {name}
              <button type="button" onClick={() => removeAttachment(name)} aria-label={`移除 ${name}`}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-slate-100" style={{ color: "var(--oc-text-secondary)" }} title="上传附件">
          <Plus size={20} />
          <input type="file" multiple className="hidden" onChange={(event) => handleAttachmentPick(event.target.files)} />
        </label>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={hasConversation ? 1 : 2}
          spellCheck={false}
          className="max-h-[256px] min-h-10 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-6 outline-none ring-0 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          style={{ color: "var(--oc-text-primary)", boxShadow: "none" }}
          placeholder={selected ? (TASK_PLACEHOLDERS[selected.id] || selected.shortDescription) : "输入想完成的任务，或先从左侧选择一个预制任务..."}
        />
        <button
          type="button"
          onClick={runTaskStream}
          disabled={!prompt.trim() || running || routing}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--oc-accent)" }}
          title={running ? "执行中" : routing ? "判断中" : hasConversation ? "发送" : "开始任务"}
        >
          {running || routing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );

  const sidePanelOpen = Boolean(preview || researchPreview || workDirectoryPreview);

  return (
    <div className="min-h-screen" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <div className="flex min-h-screen">
        <TaskSelector
          templates={templates}
          selectedId={selectedId}
          loading={loading}
          error={error}
          running={running || routing}
          run={run}
          workFolderAgentIds={workFolderAgentIds}
          onChoose={chooseTemplate}
          onPreview={openPreview}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={openWorkDirectory}
            className="fixed right-5 top-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border bg-white/90 shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5"
            style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-primary)" }}
            title="打开工作目录"
          >
            <FolderOpen size={19} />
            {run?.artifacts?.length || workFolderAgentIds.length ? (
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full" style={{ background: "var(--oc-accent)" }} />
            ) : null}
          </button>

          {!hasConversation ? (
            <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
              <div className="mb-8 text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-3xl text-white shadow-lg" style={{ background: "var(--oc-accent)" }}>
                  <Bot size={24} />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">准备好了，随时开始</h1>
              </div>
              <div className="w-full max-w-3xl">{composer}</div>
            </div>
          ) : (
            <>
              <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-32 pt-8 xl:data-[preview=true]:mr-[48vw]" data-preview={sidePanelOpen}>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.22em]" style={{ color: "var(--oc-text-tertiary)" }}>
                      Task Workbench
                    </div>
                    <h1 className="mt-1 text-xl font-semibold">{selected?.displayName || "任务执行"}</h1>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected?.outputPolicy.disclaimers.map((item) => (
                      <span key={item} className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--oc-muted)", color: "var(--oc-text-secondary)" }}>
                        {DISCLAIMER_LABELS[item] || item}
                      </span>
                    ))}
                  </div>
                </div>

                {submittedPrompt ? <UserTaskCard prompt={submittedPrompt} attachments={submittedAttachments} /> : null}
                <RouterDecisionCard routing={routing} decision={routerDecision} />

                {running || liveStages.length || run ? (
                  <section className="mt-8 space-y-1">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Sparkles size={16} style={{ color: "var(--oc-accent)" }} />
                      Agent 执行过程
                    </div>

                    {liveStages.length
                      ? liveStages.map((stage) => <LiveStageCard key={stage.stageId} stage={stage} onPreview={openPreview} onOpenResearch={openResearchPreview} />)
                      : run?.stages.map((stage) => (
                        <AgentMessageCard key={stage.stageId} stage={stage} artifacts={stage.artifacts || []} onPreview={openPreview} onOpenResearch={openResearchPreview} />
                      ))}
                  </section>
                ) : null}

                {error ? (
                  <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                    <div className="mb-1 font-semibold">任务失败</div>
                    {error}
                  </div>
                ) : null}

                {run?.disclaimers?.length ? (
                  <div className="mt-5 rounded-2xl px-4 py-3 text-xs leading-6" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-text-secondary)" }}>
                    {run.disclaimers.map((item) => DISCLAIMER_LABELS[item] || item).join(" · ")}
                  </div>
                ) : null}

                <div ref={conversationEndRef} />
              </div>

              {showJumpToLatest ? (
                <div className="pointer-events-none fixed bottom-28 left-0 right-0 z-30 px-4 lg:left-72 xl:data-[preview=true]:right-[48vw]" data-preview={sidePanelOpen}>
                  <div className="mx-auto flex max-w-3xl justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAutoScrollEnabled(true);
                        setShowJumpToLatest(false);
                        scrollToLatest("smooth");
                      }}
                      className="pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)", color: "var(--oc-text-primary)" }}
                    >
                      <ArrowDown size={14} />
                      回到最新
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-none fixed bottom-5 left-0 right-0 z-20 px-4 lg:left-72 xl:data-[preview=true]:right-[48vw]" data-preview={sidePanelOpen}>
                <div className="mx-auto max-w-3xl">{composer}</div>
              </div>
            </>
          )}
        </main>
      </div>

      {preview ? (
        <PreviewSidePanel
          preview={preview}
          onClose={() => setPreview(null)}
          onFullscreen={() => setFullscreenPreview(preview)}
        />
      ) : null}

      {researchPreview ? (
        <ResearchSourceSidePanel
          preview={researchPreview}
          onClose={() => setResearchPreview(null)}
        />
      ) : null}

      {workDirectoryPreview ? (
        <WorkDirectorySidePanel
          run={run}
          preview={workDirectoryPreview}
          onClose={() => setWorkDirectoryPreview(null)}
          onPreview={openPreview}
        />
      ) : null}

      {fullscreenPreview ? (
        <SlidePreviewModal
          open={Boolean(fullscreenPreview)}
          onClose={() => setFullscreenPreview(null)}
          previewUrl={fullscreenPreview.previewUrl}
          downloadUrl={fullscreenPreview.downloadUrl}
          fileName={fullscreenPreview.fileName}
        />
      ) : null}
    </div>
  );
}
