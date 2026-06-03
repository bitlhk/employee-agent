import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  History,
  ImageIcon,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentArtifactCard } from "@/components/document-workbench/DocumentArtifactCard";
import { DocumentComposer } from "@/components/document-workbench/DocumentComposer";
import { DocumentHistoryDrawer } from "@/components/document-workbench/DocumentHistoryDrawer";
import { DocumentPreviewPanel } from "@/components/document-workbench/DocumentPreviewPanel";
import { DocumentPromptCards } from "@/components/document-workbench/DocumentPromptCards";
import {
  DocumentBottomDock,
  DocumentTaskHeader,
  DocumentWorkbenchLayout,
} from "@/components/document-workbench/DocumentTaskLayout";
import {
  DocumentTimeline,
  DocumentUserPromptBubble,
} from "@/components/document-workbench/DocumentTimeline";
import {
  DISCLAIMER_LABELS,
  PERSONA_COLORS,
  PERSONA_DISPLAY_ALIASES,
  PERSONA_ICONS,
  PERSONA_INITIALS,
  PERSONA_LABELS,
  PERSONA_STEPS,
  TASK_ICONS,
  TASK_QUICK_PROMPTS,
  taskDescription,
  taskDisplayName,
  taskPlaceholder,
} from "@/components/document-workbench/taskConfig";
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

const GENERAL_COMPACT_TEMPLATE_IDS = [
  "research_ppt",
  "meeting_notes",
  "excel_fill",
  "video_outline",
];

const FINANCE_COMPACT_TEMPLATE_IDS = [
  "market_research_brief",
  "wind_announcement_digest",
  "meeting_prep_agent",
  "fund_compare",
  "peer_comps_analysis",
  "theme_leader_analysis",
  "earnings_commentary",
  "company_one_page_memo",
  "macro_data_brief",
  "credit_analysis",
  "bond_rate_outlook",
];

function CompactTaskSwitcher({
  templates,
  selectedId,
  disabled,
  moreOpen,
  onChoose,
  onToggleMore,
}: {
  templates: TaskTemplate[];
  selectedId: string;
  disabled: boolean;
  moreOpen: boolean;
  onChoose: (template: TaskTemplate) => void;
  onToggleMore: () => void;
}) {
  const findTemplate = (id: string) => templates.find(item => item.id === id);
  const isFinance = FINANCE_COMPACT_TEMPLATE_IDS.includes(selectedId);
  const primaryIds = isFinance
    ? FINANCE_COMPACT_TEMPLATE_IDS
    : GENERAL_COMPACT_TEMPLATE_IDS;
  const secondaryIds = isFinance
    ? GENERAL_COMPACT_TEMPLATE_IDS
    : FINANCE_COMPACT_TEMPLATE_IDS;
  const primaryTemplates = primaryIds
    .map(findTemplate)
    .filter(Boolean) as TaskTemplate[];
  const secondaryTemplates = secondaryIds
    .map(findTemplate)
    .filter(Boolean) as TaskTemplate[];
  const secondaryTitle = isFinance ? "通用办公" : "金融专业";

  if (!primaryTemplates.length && !secondaryTemplates.length) return null;

  return (
    <div className="relative mt-5 flex w-full flex-wrap items-center justify-center gap-2">
      {primaryTemplates.map(template => {
        const Icon = TASK_ICONS[template.id] || FileText;
        const active = selectedId === template.id;
        return (
          <button
            key={template.id}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(template)}
            className="inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: active
                ? "color-mix(in srgb, var(--oc-accent) 32%, transparent)"
                : "var(--oc-border)",
              background: active
                ? "color-mix(in srgb, var(--oc-accent) 10%, transparent)"
                : "color-mix(in oklab, var(--oc-bg-surface) 82%, transparent)",
              color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)",
            }}
          >
            <Icon size={15} />
            <span>{taskDisplayName(template)}</span>
          </button>
        );
      })}
      {secondaryTemplates.length ? (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={onToggleMore}
            className="inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: "var(--oc-border)",
              background:
                "color-mix(in oklab, var(--oc-bg-surface) 82%, transparent)",
              color: "var(--oc-text-secondary)",
            }}
          >
            <MoreHorizontal size={16} />
            <span>更多</span>
            <ChevronDown
              size={13}
              className={`transition ${moreOpen ? "rotate-180" : ""}`}
            />
          </button>
          <div
            className={`absolute left-full top-1/2 z-40 ml-3 w-60 -translate-y-1/2 rounded-2xl border p-2 shadow-[0_16px_44px_rgba(15,23,42,0.12)] transition-all duration-200 ease-out ${moreOpen ? "pointer-events-auto translate-x-0 opacity-100" : "pointer-events-none -translate-x-1 opacity-0"}`}
            style={{
              borderColor: "var(--oc-border)",
              background: "var(--oc-bg-elevated)",
              color: "var(--oc-text-primary)",
            }}
          >
            <div
              className="px-3 py-2 text-xs font-medium"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {secondaryTitle}
            </div>
            <div className="space-y-1">
              {secondaryTemplates.map(template => {
                const Icon = TASK_ICONS[template.id] || FileText;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-black/5"
                    onClick={() => onChoose(template)}
                  >
                    <Icon
                      size={16}
                      style={{ color: "var(--oc-text-tertiary)" }}
                    />
                    <span>{taskDisplayName(template)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function localTaskTemplate(id: string): TaskTemplate | null {
  const stagesByTemplate: Record<string, TaskTemplate["stages"]> = {
    market_research_brief: [
      {
        id: "source_reader",
        displayName: "检索员筛选公开资料",
        personaId: "reader",
        agentDefinitionId: "market-sector-reader",
      },
      {
        id: "impact_analyst",
        displayName: "分析师提炼趋势与机会",
        personaId: "analyst",
        agentDefinitionId: "market-comps-spreader",
      },
      {
        id: "brief_writer",
        displayName: "写作员生成研究简报",
        personaId: "writer",
        agentDefinitionId: "market-note-writer",
      },
    ],
    excel_fill: [
      {
        id: "excel_planner",
        displayName: "分析员生成填表方案",
        personaId: "analyst",
        agentDefinitionId: "excel-fill-planner",
      },
      {
        id: "excel_writer",
        displayName: "执行员写回 Excel 副本",
        personaId: "writer",
        agentDefinitionId: "excel-fill-writer",
      },
    ],
    meeting_notes: [
      {
        id: "audio_transcriber",
        displayName: "转写员读取录音或会议文本",
        personaId: "reader",
        agentDefinitionId: "meeting-audio-transcriber",
      },
      {
        id: "notes_writer",
        displayName: "写作员生成会议纪要",
        personaId: "writer",
        agentDefinitionId: "meeting-notes-writer",
      },
    ],
    meeting_prep_agent: [
      {
        id: "meeting_news_reader",
        displayName: "检索员整理客户与会议资料",
        personaId: "reader",
        agentDefinitionId: "meeting-news-reader",
      },
      {
        id: "meeting_profiler",
        displayName: "分析师提炼客户画像与问题清单",
        personaId: "analyst",
        agentDefinitionId: "meeting-profiler",
      },
      {
        id: "meeting_pack_writer",
        displayName: "写作员生成会前准备材料",
        personaId: "writer",
        agentDefinitionId: "meeting-pack-writer",
      },
    ],
    wind_announcement_digest: [
      {
        id: "wind_announcement_reader",
        displayName: "检索员读取万得公告与财经新闻数据",
        personaId: "reader",
        agentDefinitionId: "wind-announcement-reader",
      },
      {
        id: "impact_analyst",
        displayName: "专业写作员生成公告影响解读",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    research_ppt: [
      {
        id: "source_reader",
        displayName: "OpenClaw 联网研究并生成资料包",
        personaId: "reader",
        agentDefinitionId: "openclaw-research-ppt",
      },
      {
        id: "outline_writer",
        displayName: "OpenClaw 生成 PPT 蓝图",
        personaId: "writer",
        agentDefinitionId: "openclaw-research-ppt",
      },
      {
        id: "template_renderer",
        displayName: "模板渲染器生成 PPTX",
        personaId: "renderer",
        agentDefinitionId: "ppt-template-renderer",
      },
      {
        id: "quality_checker",
        displayName: "质量校验器检查产物",
        personaId: "checker",
        agentDefinitionId: "ppt-quality-checker",
      },
    ],
    video_outline: [
      {
        id: "video_source_reader",
        displayName: "检索员读取视频信息与可用文字资料",
        personaId: "reader",
        agentDefinitionId: "video-outline-reader",
      },
      {
        id: "outline_writer",
        displayName: "写作员生成视频提纲",
        personaId: "writer",
        agentDefinitionId: "video-outline-writer",
      },
    ],
    fund_compare: [
      {
        id: "fund_data_reader",
        displayName: "数据员读取基金资料",
        personaId: "reader",
        agentDefinitionId: "wind-fund-reader",
      },
      {
        id: "fund_compare_writer",
        displayName: "写作员生成基金对比",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    peer_comps_analysis: [
      {
        id: "peer_data_reader",
        displayName: "数据员读取公司与同业资料",
        personaId: "reader",
        agentDefinitionId: "wind-peer-reader",
      },
      {
        id: "peer_comps_writer",
        displayName: "写作员生成同业比选",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    theme_leader_analysis: [
      {
        id: "theme_data_reader",
        displayName: "数据员读取题材与候选标的资料",
        personaId: "reader",
        agentDefinitionId: "wind-theme-reader",
      },
      {
        id: "theme_leader_writer",
        displayName: "写作员生成题材龙头分析",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    earnings_commentary: [
      {
        id: "earnings_data_reader",
        displayName: "数据员读取财报与公告",
        personaId: "reader",
        agentDefinitionId: "wind-earnings-reader",
      },
      {
        id: "earnings_writer",
        displayName: "写作员生成财报点评",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    company_one_page_memo: [
      {
        id: "company_data_reader",
        displayName: "数据员读取公司资料",
        personaId: "reader",
        agentDefinitionId: "wind-company-reader",
      },
      {
        id: "company_memo_writer",
        displayName: "写作员生成公司一页纸",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    macro_data_brief: [
      {
        id: "macro_data_reader",
        displayName: "数据员读取宏观指标",
        personaId: "reader",
        agentDefinitionId: "wind-macro-reader",
      },
      {
        id: "macro_brief_writer",
        displayName: "写作员生成宏观解读",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    credit_analysis: [
      {
        id: "credit_data_reader",
        displayName: "数据员读取主体与债券资料",
        personaId: "reader",
        agentDefinitionId: "wind-credit-reader",
      },
      {
        id: "credit_writer",
        displayName: "写作员生成信用分析",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
    bond_rate_outlook: [
      {
        id: "bond_data_reader",
        displayName: "数据员读取债券与利率资料",
        personaId: "reader",
        agentDefinitionId: "wind-bond-reader",
      },
      {
        id: "bond_outlook_writer",
        displayName: "写作员生成利率研判",
        personaId: "writer",
        agentDefinitionId: "wind-report-writer",
      },
    ],
  };
  const stages = stagesByTemplate[id];
  if (!stages) return null;
  const seed = { id, displayName: id, shortDescription: "" };
  const estimatedDurationMs =
    id === "research_ppt"
      ? 300_000
      : id === "wind_announcement_digest" ||
          id === "video_outline" ||
          id === "meeting_notes" ||
          id === "excel_fill"
        ? 180_000
        : 240_000;
  return {
    id,
    displayName: taskDisplayName(seed),
    shortDescription: taskDescription(seed),
    estimatedDurationMs,
    stages,
    outputPolicy: {
      allowedArtifactTypes: ["markdown_report", "file_download"],
      disclaimers: ["ai_generated_label"],
    },
  };
}

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
  metadata?: Record<string, unknown>;
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
  dataPack?: any;
  computePack?: any;
  taskRun?: TaskRun;
  error?: { kind?: string; detail?: string };
};

const CONTROLLED_DATA_STAGE_ID = "__controlled_data_pack";
const CONTROLLED_DATA_STAGE_IDS = new Set([
  CONTROLLED_DATA_STAGE_ID,
  "controlled_data_pack",
]);
const CONTROLLED_COMPUTE_STAGE_IDS = new Set([
  "controlled_compute_pack",
]);

type RouterDecision = {
  intent: "chat" | "clarify" | "run_template" | "unsupported";
  confidence: "high" | "medium" | "low";
  selectedTemplateId?: string;
  normalizedGoal?: string;
  userVisiblePlan?: string[];
  clarifyingQuestion?: string;
  reply?: string;
  harnessPlan?: {
    source: "financial_harness";
    runId: string;
    templateId: string;
    confidenceScore?: number;
    reason?: string;
    riskFlags?: string[];
    dataRequirements?: unknown[];
    computeRequirements?: unknown[];
    stages: Array<{
      stageId: string;
      role: "Reader" | "Analyst" | "Writer";
      profile: string;
      inputContract?: string;
      outputContract?: string;
      skillRefs?: string[];
      mcpPolicy?: Record<string, unknown>;
    }>;
  };
  router?: Record<string, unknown>;
};

function hasControlledDataStage(plan?: RouterDecision["harnessPlan"] | null) {
  return Boolean(
    plan &&
      (plan.dataRequirements?.length ||
        plan.computeRequirements?.some(item => {
          if (!item || typeof item !== "object") return true;
          const type = String((item as Record<string, unknown>).type || "");
          return type && type !== "none";
        }))
  );
}

function controlledDataLiveStage(): LiveStageState {
  return {
    stageId: CONTROLLED_DATA_STAGE_ID,
    personaId: "data",
    agentDefinitionId: "employee-agent-data-pack",
    displayName: "数据准备 · employee-agent",
    status: "waiting",
    events: ["等待 Harness 规划数据需求"],
    text: "",
  };
}

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

type UploadedWorkbenchFile = {
  name: string;
  path: string;
  size: number;
};

type PptTemplateOption = {
  id: string;
  name: string;
  description?: string;
  available?: boolean;
  thumbnailUrl?: string;
  previewUrls?: string[];
};

type TaskHistoryRecord = {
  id: string;
  taskTemplateId: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  artifactCount?: number;
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
};

export type DocumentTaskWorkbenchProps = {
  adoptId?: string;
  apiBase?: string;
  templateIds?: string[];
  initialTemplateId?: string;
  initialPrompt?: string;
  titleLabel?: string;
  showSelector?: boolean;
  compactOfficeMode?: boolean;
  onBack?: () => void;
};

export type TaskWorkbenchLabProps = DocumentTaskWorkbenchProps;

function formatDuration(ms?: number) {
  if (!ms && ms !== 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)} \u5206\u949f`;
}

function statusMeta(status: string) {
  if (status === "completed" || status === "success")
    return {
      label: "\u5df2\u5b8c\u6210",
      icon: CheckCircle2,
      color: "#15803d",
    };
  if (status === "failed" || status === "timeout")
    return {
      label: status === "timeout" ? "\u5df2\u8d85\u65f6" : "\u5931\u8d25",
      icon: XCircle,
      color: "#b91c1c",
    };
  if (status === "partial_success")
    return {
      label: "\u90e8\u5206\u5b8c\u6210",
      icon: AlertTriangle,
      color: "#b45309",
    };
  if (status === "running")
    return {
      label: "\u8fd0\u884c\u4e2d",
      icon: Loader2,
      color: "var(--oc-accent)",
    };
  if (status === "waiting")
    return {
      label: "\u7b49\u5f85\u4e2d",
      icon: Clock3,
      color: "var(--oc-text-tertiary)",
    };
  return { label: status, icon: Clock3, color: "var(--oc-text-secondary)" };
}
function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const DEFAULT_UPLOAD_BYTES = 50 * 1024 * 1024;
const MEETING_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_ATTACHMENT_ACCEPT =
  ".md,.txt,.csv,.json,.pdf,.docx,.xls,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.html,.zip";
const MEETING_NOTES_ATTACHMENT_ACCEPT =
  ".mp3,.wav,.m4a,.aac,.webm,.ogg,.mp4,.txt,.md,.markdown,.docx,.pdf";

function uploadLimitForTask(taskId: string, kind: "inputs" | "templates") {
  if (kind === "inputs" && taskId === "meeting_notes")
    return MEETING_AUDIO_UPLOAD_BYTES;
  return DEFAULT_UPLOAD_BYTES;
}

function attachmentAcceptForTask(taskId: string) {
  return taskId === "meeting_notes"
    ? MEETING_NOTES_ATTACHMENT_ACCEPT
    : DEFAULT_ATTACHMENT_ACCEPT;
}

function makeWorkbenchTaskId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () =>
      reject(reader.error || new Error("read_file_failed"));
    reader.readAsDataURL(file);
  });
}

function artifactSize(artifact: Artifact) {
  const size = artifact.metadata?.size;
  return typeof size === "number" ? size : undefined;
}

function preferredDisplayArtifacts(artifacts: Artifact[]) {
  const slidePreview = artifacts.find(
    artifact => artifact.previewUrl && /slides-preview\.html?$/i.test(artifact.name)
  );
  const slideDeck = artifacts.find(
    artifact => /\.pptx$/i.test(artifact.name) && !/editable/i.test(artifact.name)
  );
  if (slidePreview && slideDeck) return [slidePreview, slideDeck];

  const wordPreviews = artifacts.filter(
    artifact => artifact.previewUrl && /\.docx?$/i.test(artifact.name)
  );
  if (wordPreviews.length) return wordPreviews;
  const generated = artifacts.filter(
    artifact =>
      artifact.metadata?.source === "financial-harness-office-artifact" ||
      artifact.type === "html" ||
      /\.html?$/i.test(artifact.name)
  );
  if (generated.length) return generated;
  return artifacts.filter(
    artifact => !/\.docx?$/i.test(artifact.name) || artifact.previewUrl
  );
}

function shouldAutoOpenArtifactPreview(run: TaskRun, artifact: Artifact) {
  if (!artifact.previewUrl) return false;
  // Report-style tasks keep the final Markdown in the left conversation and
  // expose HTML as an explicit file preview. Visual tasks can open preview
  // automatically because the artifact itself is the primary result.
  return run.taskTemplateId === "research_ppt";
}

function normalizePreviewHtml(html: string) {
  const stripped = html.replace(
    /<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi,
    ""
  );
  const isSlidePreview =
    /class=["'][^"']*\bdeck\b/i.test(stripped) &&
    /class=["'][^"']*\bslide\b/i.test(stripped);
  if (isSlidePreview) {
    const slideStyle = `
    <style>
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #eef2f7 !important;
        overflow: auto !important;
      }
      .deck {
        padding: 16px !important;
        gap: 18px !important;
      }
      .slide-frame {
        width: min(1280px, calc(100vw - 32px)) !important;
        aspect-ratio: 16 / 9 !important;
        container-type: inline-size !important;
        overflow: hidden !important;
      }
      .slide-frame > .slide {
        width: 1280px !important;
        height: 720px !important;
        transform: scale(calc(100cqw / 1280));
        transform-origin: top left;
      }
      .deck > .slide {
        zoom: 0.5;
      }
    </style>`;
    if (/<\/head>/i.test(stripped))
      return stripped.replace(/<\/head>/i, `${slideStyle}</head>`);
    return `${slideStyle}${stripped}`;
  }
  const style = `
    <style>
      html, body { font-size: 13px !important; line-height: 1.58 !important; }
      body { padding: 22px 28px !important; }
      h1 { font-size: 20px !important; margin: 0 0 16px !important; }
      h2 { font-size: 16px !important; margin: 20px 0 8px !important; }
      h3 { font-size: 14px !important; margin: 14px 0 6px !important; }
      p, li { font-size: 13px !important; line-height: 1.58 !important; }
      p { margin: 7px 0 !important; }
      ul, ol { margin: 7px 0 7px 20px !important; }
      .disclaimer { font-size: 12px !important; margin-top: 20px !important; padding: 10px 12px !important; }
    </style>`;
  if (/<\/head>/i.test(stripped))
    return stripped.replace(/<\/head>/i, `${style}</head>`);
  return `${style}${stripped}`;
}

function cleanText(text: string) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function stripCodeFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseJsonObject(text: string) {
  const normalized = stripCodeFence(text);
  const candidates = [
    normalized,
    normalized.slice(normalized.indexOf("{"), normalized.lastIndexOf("}") + 1),
  ].filter(item => item && item.startsWith("{") && item.endsWith("}"));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      // Keep trying the next shape.
    }
  }
  return null;
}

function displayStageRole(
  personaId?: string,
  agentDefinitionId?: string,
  metadata?: Record<string, unknown>
) {
  const fromMetadata = String(metadata?.role || "").toLowerCase();
  const metadataProfile = String(metadata?.profile || "").toLowerCase();
  const normalizedPersona = displayPersonaId(personaId || "");
  const profile = String(agentDefinitionId || "").toLowerCase();
  const combinedProfile = `${profile} ${metadataProfile}`;
  if (
    normalizedPersona === "data" ||
    combinedProfile.includes("data-pack") ||
    combinedProfile.includes("compute-pack")
  )
    return "data";
  if (
    fromMetadata.includes("renderer") ||
    normalizedPersona === "renderer" ||
    combinedProfile.includes("renderer")
  )
    return "renderer";
  if (
    fromMetadata.includes("checker") ||
    normalizedPersona === "checker" ||
    combinedProfile.includes("checker")
  )
    return "checker";
  if (
    combinedProfile.includes("writer") ||
    combinedProfile.includes("note-writer")
  )
    return "writer";
  if (
    combinedProfile.includes("analyst") ||
    combinedProfile.includes("comps") ||
    combinedProfile.includes("spread")
  )
    return "analyst";
  if (
    combinedProfile.includes("reader") ||
    combinedProfile.includes("sector-reader")
  )
    return "reader";
  if (fromMetadata.includes("writer") || normalizedPersona === "writer")
    return "writer";
  if (fromMetadata.includes("analyst") || normalizedPersona === "analyst")
    return "analyst";
  if (fromMetadata.includes("reader") || normalizedPersona === "reader")
    return "reader";
  return normalizedPersona || "agent";
}

function compactStageTitle(
  stage: {
    personaId?: string;
    agentDefinitionId?: string;
    displayName?: string;
    runResult?: { metadata?: Record<string, unknown> };
  },
  role: string
) {
  const roleLabel = harnessRoleLabel(
    role === "data"
      ? "数据准备"
      : role === "reader"
      ? "Reader"
      : role === "analyst"
        ? "Analyst"
        : role === "writer"
          ? "Writer"
          : role === "renderer"
            ? "Renderer"
            : role === "checker"
              ? "Checker"
              : role
  );
  const displayName = String(stage.displayName || "").trim();
  const metadataDisplayName = String(
    stage.runResult?.metadata?.stageTitle ||
      stage.runResult?.metadata?.displayName ||
      ""
  ).trim();
  const preferredDisplayName = displayName || metadataDisplayName;
  if (
    preferredDisplayName &&
    !/检索员\s*·\s*检索员|分析师\s*·\s*分析师|写作员\s*·\s*写作员/.test(
      preferredDisplayName
    )
  )
    return preferredDisplayName;
  const profile = String(
    stage.runResult?.metadata?.profile || stage.agentDefinitionId || ""
  ).trim();
  if (
    profile &&
    !["reader", "analyst", "writer"].includes(profile.toLowerCase())
  )
    return `${roleLabel} · ${profile}`;
  return roleLabel;
}

function workflowStepLabel(role: string) {
  if (role === "data") return "准备数据";
  if (role === "reader") return "检索资料";
  if (role === "analyst") return "综合分析";
  if (role === "writer") return "生成材料";
  if (role === "renderer") return "生成 PPT";
  if (role === "checker") return "质量校验";
  return personaShortLabel(role);
}

function stageOutputMode(role: string) {
  if (role === "data") return "evidence";
  if (role === "reader") return "evidence";
  if (role === "analyst") return "analysis";
  if (role === "writer") return "final";
  if (role === "renderer") return "final";
  if (role === "checker") return "analysis";
  return "default";
}

function stringList(value: unknown, limit = 4) {
  const rows = asArray(value)
    .map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const object = item as Record<string, unknown>;
        return String(
          object.claim ||
            object.finding ||
            object.title ||
            object.summary ||
            object.point ||
            ""
        );
      }
      return "";
    })
    .map(item => item.trim())
    .filter(Boolean);
  return rows.slice(0, limit);
}

function compactInsightRows(
  role: string,
  text: string,
  metadata?: Record<string, unknown>,
  limit = 5
) {
  const schemaPayload = metadata?.schemaPayload as any;
  const parsed = parseJsonObject(text);
  const payload =
    schemaPayload && typeof schemaPayload === "object" ? schemaPayload : parsed;
  const sourceResearch = metadata?.sourceResearch as any;
  const rows: string[] = [];

  const push = (value: unknown) => {
    if (rows.length >= limit) return;
    let textValue = "";
    if (typeof value === "string") {
      textValue = value;
    } else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      textValue = String(
        object.claim ||
          object.finding ||
          object.title ||
          object.summary ||
          object.point ||
          object.name ||
          object.detail ||
          object.risk ||
          object.text ||
          ""
      );
    }
    const clean = textValue.replace(/\s+/g, " ").trim();
    if (clean && !rows.includes(clean)) rows.push(clean);
  };

  if (role === "reader") {
    for (const item of asArray(
      payload?.facts ||
        payload?.items ||
        payload?.news_items ||
        payload?.sources
    ))
      push(item);
    for (const item of asArray(sourceResearch?.sources).slice(0, limit))
      push((item as any)?.title || (item as any)?.snippet);
  } else if (role === "analyst") {
    for (const key of [
      "core_findings",
      "findings",
      "key_findings",
      "analysis_points",
      "risks",
      "risk_flags",
      "uncertainties",
      "missing_information",
      "recommendations",
      "next_steps",
    ]) {
      for (const item of asArray(payload?.[key])) push(item);
    }
    const writerOutline = payload?.writer_outline as
      | { sections?: unknown[] }
      | undefined;
    for (const section of asArray(writerOutline?.sections)) {
      push((section as any)?.name);
      for (const point of asArray((section as any)?.points)) push(point);
    }
    const scan = (value: unknown, depth = 0) => {
      if (rows.length >= limit || depth > 3 || value == null) return;
      if (typeof value === "string") {
        if (value.length > 18 && value.length < 260) push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(item => scan(item, depth + 1));
        return;
      }
      if (typeof value === "object") {
        const object = value as Record<string, unknown>;
        push(
          object.finding ||
            object.claim ||
            object.summary ||
            object.detail ||
            object.recommendation ||
            object.title
        );
        Object.values(object).forEach(item => scan(item, depth + 1));
      }
    };
    if (!rows.length) scan(payload);
  }

  if (!rows.length) {
    for (const line of stripCodeFence(text).split(/\r?\n/)) {
      const clean = line.replace(/^[-*#\d.\s]+/, "").trim();
      if (
        clean &&
        !clean.startsWith("{") &&
        !clean.includes('":') &&
        clean.length > 8
      )
        push(clean);
    }
  }
  if (!rows.length && role === "analyst") {
    const flattened = stripCodeFence(text)
      .replace(/[{}[\]"]/g, " ")
      .replace(
        /\b(claim|finding|summary|detail|risk|missing_information|writer_outline)\b\s*:/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
    if (flattened) push(flattened.slice(0, 220));
  }
  return rows.slice(0, limit);
}

function compactSearchRows(metadata?: Record<string, unknown>, limit = 5) {
  const sourceResearch = normalizeResearchMetadata(metadata);
  const plan = sourceResearch.searchPlan || {};
  const queries = asArray(plan.queries)
    .map(item => String(item))
    .filter(Boolean);
  const fallbackQueries = asArray(plan.sourceHunt?.fallbackQueries)
    .map(item => String(item))
    .filter(Boolean);
  const sourceHints = asArray(sourceResearch.sources)
    .map(item => {
      if (!item || typeof item !== "object") return "";
      const source = item as Record<string, unknown>;
      const title = String(source.title || source.name || "").trim();
      const url = String(source.url || "").trim();
      try {
        const host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
        return title && host ? `${title} · ${host}` : title || host;
      } catch {
        return title || url;
      }
    })
    .filter(Boolean);
  return [...queries, ...fallbackQueries, ...sourceHints].slice(0, limit);
}

function normalizeResearchMetadata(metadata?: Record<string, unknown>) {
  const sourceResearch = (metadata?.sourceResearch || {}) as any;
  const hasSourceResearch = Boolean(
    sourceResearch?.searchPlan ||
      sourceResearch?.sources ||
      sourceResearch?.discardedSources
  );
  const plan = hasSourceResearch
    ? sourceResearch.searchPlan || {}
    : ((metadata?.searchPlan || {}) as any);
  const sources = hasSourceResearch
    ? asArray(sourceResearch.sources)
    : asArray(metadata?.sources || metadata?.searchResults);
  const discardedSources = hasSourceResearch
    ? asArray(sourceResearch.discardedSources)
    : asArray(metadata?.discardedSources);
  const searchErrors = [
    ...asArray(sourceResearch.searchErrors),
    ...asArray(metadata?.searchErrors),
  ]
    .map(item => String(item))
    .filter(Boolean);
  const providers = [
    ...asArray(sourceResearch.searchProviders),
    ...asArray(metadata?.searchProviders),
  ]
    .map(item => String(item))
    .filter(Boolean);
  const attemptedProviders = [
    ...asArray(sourceResearch.searchProvidersAttempted),
    ...asArray(metadata?.searchProvidersAttempted),
  ]
    .map(item => String(item))
    .filter(Boolean);
  const searchResultCount =
    typeof metadata?.searchResultCount === "number"
      ? metadata.searchResultCount
      : typeof sourceResearch.searchResultCount === "number"
        ? sourceResearch.searchResultCount
        : sources.length;
  return {
    ...sourceResearch,
    searchPlan: plan,
    sources,
    discardedSources,
    searchErrors,
    searchProviders: providers,
    searchProvidersAttempted: attemptedProviders,
    searchResultCount,
    searchElapsedMs:
      metadata?.searchElapsedMs ?? sourceResearch.searchElapsedMs ?? null,
    outputMarkdown: String((metadata as any)?.__output || ""),
  };
}

function hasResearchDetails(metadata?: Record<string, unknown>) {
  const normalized = normalizeResearchMetadata(metadata);
  const plan = normalized.searchPlan || {};
  return Boolean(
    asArray(plan.queries).length ||
      normalized.sources.length ||
      normalized.outputMarkdown ||
      normalized.searchResultCount ||
      normalized.searchProviders.length ||
      normalized.searchErrors.length
  );
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
          <code
            key={`${part}-${index}`}
            className="rounded-md px-1 py-0.5 text-[0.92em]"
            style={{ background: "var(--oc-bg-soft)" }}
          >
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
    .map(cell => cell.trim());
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

function MarkdownContent({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
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
      const cls = compact
        ? level === 1
          ? "text-base font-semibold"
          : level === 2
            ? "text-sm font-semibold"
            : "text-[13px] font-semibold"
        : level === 1
          ? "text-2xl font-semibold"
          : level === 2
            ? "text-xl font-semibold"
            : "text-base font-semibold";
      blocks.push(
        <div
          key={`h-${i}`}
          className={cls}
          style={{ color: "var(--oc-text-primary)" }}
        >
          {content}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr-${i}`}
          className="border-0 border-t"
          style={{ borderColor: "var(--oc-border)" }}
        />
      );
      i += 1;
      continue;
    }

    if (
      trimmed.startsWith("|") &&
      lines[i + 1] &&
      isTableSeparator(lines[i + 1])
    ) {
      const header = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div
          key={`table-${i}`}
          className="overflow-x-auto rounded-2xl border"
          style={{ borderColor: "var(--oc-border)" }}
        >
          <table className="min-w-full border-collapse text-sm">
            <thead style={{ background: "var(--oc-bg-soft)" }}>
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={`${cell}-${index}`}
                    className="border-b px-3 py-2 text-left font-semibold"
                    style={{ borderColor: "var(--oc-border)" }}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={`row-${rowIndex}`}
                  className={rowIndex % 2 ? "bg-black/[0.015]" : ""}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${cell}-${cellIndex}`}
                      className="border-b px-3 py-2 align-top"
                      style={{ borderColor: "var(--oc-border)" }}
                    >
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
        <blockquote
          key={`quote-${i}`}
          className={`${compact ? "text-xs leading-6" : "text-sm leading-7"} rounded-2xl border-l-4 px-4 py-3`}
          style={{
            borderColor: "var(--oc-accent)",
            background: "var(--oc-bg-soft)",
            color: "var(--oc-text-secondary)",
          }}
        >
          {quotes.map((quote, index) => (
            <p key={`${quote}-${index}`}>{renderInline(quote)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const firstNumber = ordered
        ? Number(trimmed.match(/^(\d+)\.\s+/)?.[1] || 1)
        : undefined;
      const items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && pattern.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(pattern, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${i}`}
          start={ordered ? firstNumber : undefined}
          className={`${compact ? "space-y-1.5 text-[13px] leading-6" : "space-y-2 text-[15px] leading-7"} pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isMarkdownBlockStart(lines[i], lines[i + 1])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p
        key={`p-${i}`}
        className={compact ? "text-[13px] leading-6" : "text-[15px] leading-8"}
        style={{ color: "var(--oc-text-primary)" }}
      >
        {renderInline(paragraph.join(" "))}
      </p>
    );
  }

  return <div className={compact ? "space-y-3" : "space-y-5"}>{blocks}</div>;
}

function appendLimited(list: string[], item: string, limit = 20) {
  const trimmed = item.trim();
  if (!trimmed) return list;
  const next = list[list.length - 1] === trimmed ? list : [...list, trimmed];
  return next.slice(Math.max(0, next.length - limit));
}

function normalizeProgressMessage(message: string) {
  const text = cleanText(String(message || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("__files") || lower.includes("files ready"))
    return "\u6574\u7406\u4ea4\u4ed8\u6587\u4ef6";
  if (
    lower.includes("ppt") ||
    lower.includes("slide") ||
    lower.includes("ppt-insight")
  )
    return "\u8c03\u7528 PPT \u751f\u6210\u6280\u80fd";
  if (
    /^\$?\s*node\b/.test(text) ||
    lower.includes("/home/ubuntu") ||
    lower.includes(".claude/skills")
  )
    return "\u51c6\u5907 Agent \u6267\u884c\u73af\u5883";
  if (text.includes("\u5904\u7406\u4e2d") || lower.includes("processing"))
    return "\u6b63\u5728\u751f\u6210\u5185\u5bb9";
  if (text.length > 80) return `${text.slice(0, 80)}...`;
  return text;
}
function personaLabel(
  stage: Pick<TaskStageResult, "personaId"> | { personaId: string }
) {
  const personaId = displayPersonaId(stage.personaId);
  return PERSONA_LABELS[personaId] || `${personaId} (AI)`;
}

function personaShortLabel(personaId: string) {
  return personaLabel({ personaId }).replace(/\s*\(AI\)\s*[·|-]\s*/, " · ");
}

function personaRole(personaId: string) {
  const parts = personaLabel({ personaId }).split(/[·|-]/);
  return parts[1]?.trim() || "\u667a\u80fd\u4f53\u4e13\u5458";
}

function personaInitial(personaId: string) {
  return PERSONA_INITIALS[displayPersonaId(personaId)] || "AI";
}

function personaColor(personaId: string) {
  return (
    PERSONA_COLORS[displayPersonaId(personaId)] || {
      fg: "var(--oc-accent)",
      bg: "var(--oc-accent)",
      soft: "var(--oc-bg-soft)",
    }
  );
}

function displayPersonaId(personaId: string) {
  return PERSONA_DISPLAY_ALIASES[personaId] || personaId;
}

function PersonaAvatar({
  personaId,
  size = "md",
  failed = false,
}: {
  personaId: string;
  size?: "xs" | "sm" | "md" | "lg";
  failed?: boolean;
}) {
  const displayId = displayPersonaId(personaId);
  const Icon = PERSONA_ICONS[displayId] || Bot;
  const color = personaColor(personaId);
  const sizeClass =
    size === "xs"
      ? "h-6 w-6 text-[10px]"
      : size === "sm"
        ? "h-8 w-8 text-xs"
        : size === "lg"
          ? "h-12 w-12 text-base"
          : "h-10 w-10 text-sm";
  const iconSize =
    size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 22 : 18;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass}`}
      style={{
        background: failed ? "#b91c1c" : color.bg,
        boxShadow: `0 10px 24px ${failed ? "rgba(185,28,28,0.18)" : color.soft}`,
      }}
      title={personaLabel({ personaId })}
    >
      {size === "xs" ? personaInitial(personaId) : <Icon size={iconSize} />}
    </span>
  );
}

function ArtifactCard({
  artifact,
  onPreview,
}: {
  artifact: Artifact;
  onPreview: (artifact: Artifact) => void;
}) {
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
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        if (cancelled) return;
        // 用 srcDoc 渲染，避开公网 iframe header / CSP 对直接嵌入的限制。
        setPreviewHtml(normalizePreviewHtml(html));
      })
      .catch((error: Error) => {
        if (!cancelled) setPreviewError(error.message || "preview_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.previewUrl]);

  return (
    <div
      className="overflow-hidden rounded-3xl border shadow-sm"
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}
    >
      {canPreview ? (
        <div className="relative aspect-video bg-white">
          {previewHtml ? (
            <iframe
              title={artifact.name}
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {previewError
                ? "内嵌预览加载失败，请使用全屏预览"
                : "正在加载预览..."}
            </div>
          )}
          <div
            className="absolute left-3 top-3 flex max-w-[68%] items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-white"
            style={{
              background: "rgba(0,0,0,0.62)",
              backdropFilter: "blur(8px)",
            }}
          >
            <Presentation size={14} style={{ color: "#ffb3b3" }} />
            <span className="truncate">
              {artifact.name.replace(/\.pptx$/i, "")}
            </span>
          </div>
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPreview(artifact)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{
                background: "rgba(0,0,0,0.65)",
                border: "1px solid rgba(255,255,255,0.16)",
              }}
              title="全屏预览"
            >
              <Maximize2 size={14} />
            </button>
            {artifact.downloadUrl ? (
              <a
                href={artifact.downloadUrl}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{
                  background: "rgba(0,0,0,0.65)",
                  border: "1px solid rgba(255,255,255,0.16)",
                }}
                title="下载"
              >
                <Download size={14} />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          className="flex h-36 items-center justify-center"
          style={{ background: "var(--oc-bg-soft)" }}
        >
          <FileText size={26} style={{ color: "var(--oc-text-tertiary)" }} />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {artifact.name}
            </div>
            <div
              className="mt-1 text-xs"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {artifact.type.toUpperCase()} {formatSize(artifactSize(artifact))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {canPreview ? (
              <button
                type="button"
                onClick={() => onPreview(artifact)}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: "var(--oc-muted)",
                  color: "var(--oc-text-primary)",
                }}
              >
                预览
              </button>
            ) : null}
            {artifact.downloadUrl ? (
              <a
                href={artifact.downloadUrl}
                className="rounded-full px-3 py-1 text-xs font-medium text-white"
                style={{ background: "var(--oc-accent)" }}
              >
                下载
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactArtifactCard({
  artifact,
  onPreview,
}: {
  artifact: Artifact;
  onPreview: (artifact: Artifact) => void;
}) {
  const canPreview = Boolean(artifact.previewUrl);
  const label =
    artifact.type === "html" || /\.html?$/i.test(artifact.name)
      ? "HTML 报告"
      : artifact.type === "pptx"
        ? "PPT"
        : fileTypeFromName(artifact.name);
  return (
    <DocumentArtifactCard
      name={artifact.name}
      typeLabel={label}
      sizeLabel={formatSize(artifactSize(artifact))}
      previewable={canPreview}
      downloadUrl={artifact.downloadUrl}
      onPreview={() => onPreview(artifact)}
    />
  );
}

function shouldInlinePreviewArtifact(artifact: Artifact) {
  return Boolean(artifact.previewUrl && /slides-preview/i.test(artifact.name));
}

function ArtifactDisplayCard({
  artifact,
  onPreview,
}: {
  artifact: Artifact;
  onPreview: (artifact: Artifact) => void;
}) {
  if (shouldInlinePreviewArtifact(artifact)) {
    return <ArtifactCard artifact={artifact} onPreview={onPreview} />;
  }
  return <CompactArtifactCard artifact={artifact} onPreview={onPreview} />;
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
  const [filesByAgent, setFilesByAgent] = useState<
    Record<string, BusinessFile[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentKey = agentIds.join("|");
  const files = agentIds.flatMap(agentId =>
    (filesByAgent[agentId] || []).map(file => ({ ...file, agentId }))
  );

  const loadFiles = async () => {
    if (!agentIds.length) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        agentIds.map(async agentId => {
          const response = await fetch(
            `/api/claw/business-files?agentId=${encodeURIComponent(agentId)}`,
            { credentials: "include" }
          );
          if (!response.ok)
            throw new Error(`${agentId}: HTTP ${response.status}`);
          const data = await response.json().catch(() => ({}));
          return [
            agentId,
            Array.isArray(data.files) ? data.files : [],
          ] as const;
        })
      );
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
    <div
      className="mt-5 rounded-3xl border p-4"
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}
    >
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
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "var(--oc-bg-soft)",
              color: "var(--oc-accent)",
            }}
          >
            <FolderOpen size={22} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">工作文件夹</span>
            <span
              className="mt-1 block text-xs"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              查看本次生成后的文件目录，适合找 HTML、PPTX、PDF、Word
              等全部产物。
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
              style={{
                background: "var(--oc-muted)",
                color: "var(--oc-text-primary)",
              }}
            >
              <RefreshCw
                size={13}
                className={loading ? "animate-spin" : undefined}
              />
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
            style={{
              background: open ? "var(--oc-accent)" : "var(--oc-muted)",
              color: open ? "white" : "var(--oc-text-primary)",
            }}
          >
            {open ? "收起" : "打开"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4">
          {loading ? (
            <div
              className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm"
              style={{
                background: "var(--oc-bg-soft)",
                color: "var(--oc-text-secondary)",
              }}
            >
              <Loader2 size={15} className="animate-spin" />
              正在读取工作文件夹...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : files.length ? (
            <div className="grid gap-2">
              {files.slice(0, 12).map(file => (
                <div
                  key={`${file.agentId}-${file.name}`}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2"
                  style={{ background: "var(--oc-bg-soft)" }}
                >
                  <FileText
                    size={16}
                    className="shrink-0"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{file.name}</div>
                    <div
                      className="mt-0.5 text-[11px]"
                      style={{ color: "var(--oc-text-tertiary)" }}
                    >
                      {file.agentId} {formatSize(file.size)}
                    </div>
                  </div>
                  <a
                    href={businessFileDownloadUrl(file.agentId, file.name)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-white"
                    style={{ background: "var(--oc-accent)" }}
                  >
                    下载
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="rounded-2xl px-4 py-3 text-sm"
              style={{
                background: "var(--oc-bg-soft)",
                color: "var(--oc-text-tertiary)",
              }}
            >
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

function WorkDirectoryContent({
  run,
  agentIds,
  onPreview,
  compact = false,
}: {
  run: TaskRun | null;
  agentIds: string[];
  onPreview: (artifact: Artifact) => void;
  compact?: boolean;
}) {
  const [filesByAgent, setFilesByAgent] = useState<
    Record<string, BusinessFile[]>
  >({});
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
      for (const artifact of stage.artifacts ||
        stage.runResult?.artifacts ||
        []) {
        pushArtifact(artifact, stage);
      }
    }
    for (const artifact of run.artifacts || []) pushArtifact(artifact);
    return items;
  }, [run]);

  const businessItems = useMemo<DirectoryItem[]>(() => {
    return agentIds.flatMap(agentId =>
      (filesByAgent[agentId] || []).map(file => ({
        key: `business:${agentId}:${file.name}`,
        kind: "business" as const,
        name: file.name,
        type: fileTypeFromName(file.name),
        size: file.size,
        agentId,
        downloadUrl: businessFileDownloadUrl(agentId, file.name),
        previewable: false as const,
        agentLabel: agentId,
      }))
    );
  }, [agentIds, filesByAgent]);

  const visibleItems = [...artifactItems, ...businessItems].filter(
    item => !hiddenKeys.has(item.key)
  );

  const loadFiles = async () => {
    if (!agentIds.length) return;
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        agentIds.map(async agentId => {
          const response = await fetch(
            `/api/claw/business-files?agentId=${encodeURIComponent(agentId)}`,
            { credentials: "include" }
          );
          if (!response.ok)
            throw new Error(`${agentId}: HTTP ${response.status}`);
          const data = await response.json().catch(() => ({}));
          return [
            agentId,
            Array.isArray(data.files) ? data.files : [],
          ] as const;
        })
      );
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
    <div
      className={compact ? "rounded-2xl border p-3" : "rounded-3xl border p-4"}
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}
    >
      {!run ? (
        <div
          className="flex items-start gap-3 text-xs leading-5"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          <FolderOpen size={16} className="mt-0.5 shrink-0" />
          <span>任务完成后，PPT、HTML、PDF、Word 等文件会出现在这里。</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : visibleItems.length ? (
        <div className="space-y-2">
          {visibleItems.slice(0, compact ? 10 : 80).map(item => (
            <div
              key={item.key}
              className="rounded-xl px-2.5 py-2"
              style={{ background: "var(--oc-bg-soft)" }}
            >
              <div className="flex items-start gap-2">
                <FileText
                  size={15}
                  className="mt-0.5 shrink-0"
                  style={{ color: "var(--oc-text-tertiary)" }}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-xs font-medium"
                    title={item.name}
                  >
                    {item.name}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px]"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  >
                    {item.type} {formatSize(item.size)}{" "}
                    {item.agentLabel ? `· ${item.agentLabel}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 pl-6">
                {item.kind === "artifact" && item.previewable ? (
                  <button
                    type="button"
                    onClick={() => onPreview(item.artifact)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      background: "var(--oc-card)",
                      color: "var(--oc-text-primary)",
                    }}
                  >
                    预览
                  </button>
                ) : null}
                {item.downloadUrl ? (
                  <a
                    href={item.downloadUrl}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
                    style={{ background: "var(--oc-accent)" }}
                  >
                    下载
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setHiddenKeys(current => new Set([...current, item.key]))
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    background: "var(--oc-card)",
                    color: "var(--oc-text-tertiary)",
                  }}
                  title="从当前工作台隐藏，审计记录仍保留"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {compact && visibleItems.length > 10 ? (
            <div
              className="px-2 text-[11px]"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              还有 {visibleItems.length - 10} 个文件，后续接完整目录页。
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FolderOpen size={14} />
          )}
          {loading ? "正在读取文件..." : "暂时没有文件。"}
        </div>
      )}
    </div>
  );
}

function SidebarWorkDirectory({
  run,
  agentIds,
  onPreview,
}: {
  run: TaskRun | null;
  agentIds: string[];
  onPreview: (artifact: Artifact) => void;
}) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between px-2">
        <div
          className="text-xs font-medium uppercase tracking-[0.18em]"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          工作目录
        </div>
      </div>
      <WorkDirectoryContent
        run={run}
        agentIds={agentIds}
        onPreview={onPreview}
        compact
      />
    </section>
  );
}

function WorkDirectorySidePanel({
  run,
  preview,
  onClose,
  onPreview,
}: {
  run: TaskRun | null;
  preview: WorkDirectoryPreviewState;
  onClose: () => void;
  onPreview: (artifact: Artifact) => void;
}) {
  return (
    <DocumentPreviewPanel
      title="工作目录"
      subtitle="当前任务产物 + 各 Agent 工作文件夹"
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <WorkDirectoryContent
          run={run}
          agentIds={preview.agentIds}
          onPreview={onPreview}
        />
      </div>
    </DocumentPreviewPanel>
  );
}

function PreviewSidePanel({
  preview,
  onClose,
  onFullscreen,
}: {
  preview: PreviewState;
  onClose: () => void;
  onFullscreen: () => void;
}) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewHtml(null);
    setPreviewError(null);
    fetch(preview.previewUrl, { credentials: "include" })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        if (cancelled) return;
        setPreviewHtml(normalizePreviewHtml(html));
      })
      .catch((error: Error) => {
        if (!cancelled) setPreviewError(error.message || "preview_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [preview.previewUrl]);

  return (
    <DocumentPreviewPanel
      title={preview.fileName}
      downloadUrl={preview.downloadUrl}
      onClose={onClose}
      onFullscreen={onFullscreen}
    >
      <div className="min-h-0 flex-1 bg-white p-6">
        {previewHtml ? (
          <div
            className="h-full overflow-hidden rounded-[12px] border"
            style={{ borderColor: "#EAEAEA", background: "#FAFAF9" }}
          >
            <iframe
              title={preview.fileName}
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="h-full w-full border-0"
            />
          </div>
        ) : (
          <div
            className="flex h-full items-center justify-center rounded-[12px] border text-sm"
            style={{
              borderColor: "#EAEAEA",
              background: "#FAFAF9",
              color: "var(--oc-text-tertiary)",
            }}
          >
            {previewError ? `预览加载失败：${previewError}` : "正在加载预览..."}
          </div>
        )}
      </div>
    </DocumentPreviewPanel>
  );
}

function ResearchSourceSidePanel({
  preview,
  onClose,
}: {
  preview: ResearchPreviewState;
  onClose: () => void;
}) {
  const sourceResearch = normalizeResearchMetadata(preview.metadata);
  const plan = sourceResearch.searchPlan || {};
  const sources = asArray(sourceResearch.sources);
  const discarded = asArray(sourceResearch.discardedSources);
  const providers = asArray(sourceResearch.searchProviders)
    .map(item => String(item))
    .filter(Boolean);
  const attemptedProviders = asArray(sourceResearch.searchProvidersAttempted)
    .map(item => String(item))
    .filter(Boolean);
  const searchErrors = asArray(sourceResearch.searchErrors)
    .map(item => String(item))
    .filter(Boolean);
  const resultCount =
    typeof sourceResearch.searchResultCount === "number"
      ? sourceResearch.searchResultCount
      : sources.length;
  const queries = asArray(plan.queries)
    .map(item => String(item))
    .filter(Boolean);
  const fallbackQueries = asArray(plan.sourceHunt?.fallbackQueries)
    .map(item => String(item))
    .filter(Boolean);

  return (
    <DocumentPreviewPanel
      title={`${preview.title} · 资料来源`}
      subtitle={`${confidenceLabel(sourceResearch.confidence)} · 命中 ${resultCount} 条 · ${providers.length ? providers.join(" / ") : "检索源"}`}
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
        <section
          className="mb-4 grid gap-2 text-xs sm:grid-cols-3"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          <div className="rounded-[10px] bg-[#FAFAF9] px-3 py-2">
            命中来源 {resultCount}
          </div>
          <div className="rounded-[10px] bg-[#FAFAF9] px-3 py-2">
            已用 {providers.length ? providers.join(" / ") : "-"}
          </div>
          <div className="rounded-[10px] bg-[#FAFAF9] px-3 py-2">
            尝试 {attemptedProviders.length ? attemptedProviders.join(" / ") : "-"}
          </div>
        </section>
        <section
          className="rounded-[10px] p-4"
          style={{ background: "#FAFAF9" }}
        >
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--oc-text-primary)" }}
          >
            检索规划
          </div>
          {plan.rationale ? (
            <p
              className="mt-2 text-xs leading-6"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              {String(plan.rationale)}
            </p>
          ) : null}
          {plan.sourceHunt?.rationale ? (
            <p
              className="mt-2 text-xs leading-6"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              {String(plan.sourceHunt.rationale)}
            </p>
          ) : null}
          <div className="mt-4 space-y-2">
            {[...queries, ...fallbackQueries]
              .slice(0, 20)
              .map((query, index) => (
                <div
                  key={`${query}-${index}`}
                  className="rounded-[10px] bg-white px-4 py-3 text-xs leading-5"
                  style={{ color: "var(--oc-text-secondary)" }}
                >
                  <span
                    className="mr-2 font-mono text-[10px]"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {query}
                </div>
            ))}
          </div>
        </section>

        {searchErrors.length ? (
          <section
            className="mt-4 rounded-[10px] border px-4 py-3 text-xs leading-6"
            style={{
              borderColor: "rgba(245,158,11,0.28)",
              background: "rgba(245,158,11,0.08)",
              color: "#92400e",
            }}
          >
            <div className="font-semibold">检索异常</div>
            <ul className="mt-1 list-disc pl-4">
              {searchErrors.slice(0, 6).map(error => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {sourceResearch.outputMarkdown ? (
          <section className="mt-4 rounded-[10px] border border-[#EEEEEE] bg-white p-4">
            <div
              className="mb-2 text-xs font-semibold"
              style={{ color: "var(--oc-text-primary)" }}
            >
              资料包摘要
            </div>
            <article
              className="prose prose-sm max-w-none text-xs leading-6"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              <MarkdownContent text={sourceResearch.outputMarkdown} compact />
            </article>
          </section>
        ) : null}

        {sources.length ? (
        <section className="mt-4 space-y-2">
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--oc-text-primary)" }}
          >
            采用来源
          </div>
          {sources.map(source => (
            <a
              key={source.sourceId || source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-[14px] border bg-white p-4 text-xs leading-6 transition hover:-translate-y-0.5"
              style={{
                borderColor: "#EEEEEE",
                color: "var(--oc-text-secondary)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="font-mono text-[10px]"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  {source.sourceId || "src"}
                </span>
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{
                    background: "var(--oc-muted)",
                    color: "var(--oc-text-primary)",
                  }}
                >
                  {sourceRoleLabel(source.evidenceRole)}
                </span>
                <span>{source.publisherClass || "unknown"}</span>
                {source.sourceScore?.finalScore != null ? (
                  <span>score {source.sourceScore.finalScore}</span>
                ) : null}
              </div>
              <div
                className="mt-2 text-sm font-semibold leading-6"
                style={{ color: "var(--oc-text-primary)" }}
              >
                {source.title}
              </div>
              {source.snippet ? (
                <div className="mt-2 line-clamp-4">{source.snippet}</div>
              ) : null}
              <div
                className="mt-2 truncate"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {source.url}
              </div>
            </a>
          ))}
        </section>
        ) : null}

        {discarded.length ? (
          <section className="mt-5 space-y-2">
            <div
              className="text-xs font-semibold"
              style={{ color: "var(--oc-text-primary)" }}
            >
              过滤来源
            </div>
            {discarded.slice(0, 40).map(source => (
              <div
                key={source.url}
                className="rounded-[12px] border px-4 py-3 text-xs leading-6"
                style={{
                  borderColor: "#EEEEEE",
                  background: "#FAFAF9",
                  color: "var(--oc-text-secondary)",
                }}
              >
                <div
                  className="font-medium"
                  style={{ color: "var(--oc-text-primary)" }}
                >
                  {source.title}
                </div>
                <div className="mt-1">
                  {source.discardReason || source.qualityReason || "未采用"}
                </div>
                <div
                  className="mt-1 truncate"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  {source.url}
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </DocumentPreviewPanel>
  );
}

function UserTaskCard({
  prompt,
  attachments,
}: {
  prompt: string;
  attachments: Array<string | { name: string }>;
}) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-3xl rounded-[28px] px-5 py-4 shadow-sm"
        style={{ background: "var(--oc-accent)", color: "white" }}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium opacity-80">
          <UserRound size={14} />
          你发起了任务
        </div>
        <div className="whitespace-pre-wrap text-sm leading-7">{prompt}</div>
        {attachments.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map(attachment => {
              const name =
                typeof attachment === "string" ? attachment : attachment.name;
              return (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs"
                >
                  <Paperclip size={13} />
                  {name}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompactUserPrompt({ prompt }: { prompt: string }) {
  return <DocumentUserPromptBubble prompt={prompt} />;
}

function harnessTemplateLabel(templateId?: string) {
  if (templateId === "market-researcher")
    return "\u91d1\u878d\u5e02\u573a\u7814\u7a76\u7b80\u62a5";
  if (templateId === "meeting-prep-agent")
    return "\u5ba2\u6237\u4f1a\u8bae\u51c6\u5907 Agent";
  if (templateId === "clarify") return "\u9700\u8981\u8865\u5145\u4fe1\u606f";
  if (templateId === "reject_or_reframe")
    return "\u9700\u4eba\u5de5\u6539\u5199\u76ee\u6807";
  return "任务流程";
}

function harnessConfidenceLabel(score?: number) {
  if (typeof score !== "number" || !Number.isFinite(score))
    return "\u7f6e\u4fe1\u5ea6\u5f85\u8bc4\u4f30";
  return "\u7f6e\u4fe1\u5ea6 " + Math.round(score * 100) + "%";
}

function harnessRoleLabel(role?: string) {
  if (role === "Reader") return "\u68c0\u7d22\u5458";
  if (role === "Analyst") return "\u5206\u6790\u5e08";
  if (role === "Writer") return "\u5199\u4f5c\u5458";
  if (role === "Renderer") return "\u751f\u6210\u5668";
  if (role === "Checker") return "\u6821\u9a8c\u5668";
  return role || "\u4e13\u5458";
}

function harnessRoleDescription(role?: string) {
  if (role === "Reader")
    return "\u68c0\u7d22\u516c\u5f00\u8d44\u6599\uff0c\u8f93\u51fa\u7ed3\u6784\u5316\u8bc1\u636e";
  if (role === "Analyst")
    return "\u5206\u6790\u4e0a\u6e38\u8bc1\u636e\uff0c\u4e0d\u76f4\u63a5\u5916\u641c";
  if (role === "Writer")
    return "\u6574\u7406\u6700\u7ec8\u4ea4\u4ed8\uff0c\u4e0d\u63a5\u5916\u90e8\u641c\u7d22";
  return "\u6309\u4efb\u52a1\u5206\u5de5\u6267\u884c";
}

function RouterDecisionCard({
  routing,
  decision,
}: {
  routing: boolean;
  decision: RouterDecision | null;
}) {
  if (!routing && !decision) return null;
  const plan = decision?.harnessPlan;
  const isRun = decision?.intent === "run_template";
  const isClarify = decision?.intent === "clarify";
  const isUnsupported = decision?.intent === "unsupported";
  const title = routing
    ? "\u6b63\u5728\u8bc6\u522b\u4efb\u52a1\u7c7b\u578b"
    : isRun
      ? "\u5df2\u8bc6\u522b\u4e3a\uff1a" +
        harnessTemplateLabel(plan?.templateId)
      : isClarify
        ? "\u9700\u8981\u8865\u5145\u4efb\u52a1\u76ee\u6807"
        : isUnsupported
          ? "\u8be5\u8bf7\u6c42\u4e0d\u4f1a\u81ea\u52a8\u6267\u884c"
          : "\u4efb\u52a1\u5de5\u4f5c\u53f0";
  const body = routing
    ? "正在理解你的目标，并选择合适的任务流程。"
    : decision?.reply ||
      decision?.clarifyingQuestion ||
      decision?.normalizedGoal ||
      plan?.reason ||
      "";
  const score = plan?.confidenceScore;

  return (
    <div className="mt-5 flex justify-start">
      <div
        className="max-w-3xl rounded-[28px] border bg-white px-5 py-4 shadow-sm"
        style={{
          borderColor: isUnsupported
            ? "rgba(220,38,38,0.22)"
            : "var(--oc-border)",
        }}
      >
        <div
          className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold"
          style={{
            color: isUnsupported ? "#b91c1c" : "var(--oc-text-primary)",
          }}
        >
          {routing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isUnsupported ? (
            <AlertTriangle size={16} />
          ) : (
            <Sparkles size={16} style={{ color: "var(--oc-accent)" }} />
          )}
          <span>{title}</span>
          {isRun && typeof score === "number" ? (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                background: "var(--oc-bg-soft)",
                color: "var(--oc-text-secondary)",
              }}
            >
              {harnessConfidenceLabel(score)}
            </span>
          ) : null}
        </div>
        {body ? (
          <div
            className="whitespace-pre-wrap text-sm leading-7"
            style={{ color: "var(--oc-text-secondary)" }}
          >
            {body}
          </div>
        ) : null}

        {isRun && plan?.stages?.length ? (
          <div
            className="mt-4 rounded-2xl border px-3 py-3 text-xs"
            style={{
              borderColor: "var(--oc-border)",
              background: "var(--oc-bg-soft)",
              color: "var(--oc-text-secondary)",
            }}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div
                  className="font-semibold"
                  style={{ color: "var(--oc-text-primary)" }}
                >
                  {"\u6267\u884c\u94fe\u8def"}
                </div>
                <div
                  className="mt-1"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  {hasControlledDataStage(plan)
                    ? "\u6570\u636e\u51c6\u5907 \u2192 \u5206\u6790\u5e08 \u2192 \u5199\u4f5c\u5458"
                    : "\u68c0\u7d22\u5458 \u2192 \u5206\u6790\u5e08 \u2192 \u5199\u4f5c\u5458"}
                </div>
              </div>
              <span
                className="rounded-full bg-white px-2.5 py-1 font-mono text-[11px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {plan.templateId}
              </span>
            </div>
            <div className="grid gap-2">
              {hasControlledDataStage(plan) ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/75 px-3 py-2">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: "var(--oc-accent)" }}
                  >
                    1
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--oc-text-primary)" }}
                  >
                    数据准备
                  </span>
                  <span>employee-agent 按权限取数、计算并生成数据包</span>
                  <span
                    className="font-mono"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  >
                    DataPack / ComputePack
                  </span>
                </div>
              ) : null}
              {plan.stages.map((stage, index) => (
                <div
                  key={stage.stageId + "-" + stage.profile}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-white/75 px-3 py-2"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: "var(--oc-accent)" }}
                  >
                    {index + 1 + (hasControlledDataStage(plan) ? 1 : 0)}
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--oc-text-primary)" }}
                  >
                    {harnessRoleLabel(stage.role)}
                  </span>
                  <span>{harnessRoleDescription(stage.role)}</span>
                  <span
                    className="font-mono"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  >
                    {stage.profile}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompactRouterStage({
  routing,
  decision,
  selected,
}: {
  routing: boolean;
  decision: RouterDecision | null;
  selected: TaskTemplate | null;
}) {
  if (!routing && !decision) return null;
  const plan = decision?.harnessPlan;
  const isRun = decision?.intent === "run_template";
  const templateStageCount =
    isRun &&
    decision?.selectedTemplateId &&
    selected?.id === decision.selectedTemplateId
      ? selected.stages.length
      : 0;
  const dataStageCount = hasControlledDataStage(plan) ? 1 : 0;
  const stageCount =
    (plan?.stages?.length ? plan.stages.length + dataStageCount : 0) ||
    templateStageCount ||
    decision?.userVisiblePlan?.length ||
    0;
  const summary = routing
    ? "正在理解任务目标，并选择合适的执行流程。"
    : decision?.reply ||
      decision?.normalizedGoal ||
      plan?.reason ||
      decision?.clarifyingQuestion ||
      "";
  const roleText = stageCount
    ? [
        ...(dataStageCount ? ["数据准备"] : []),
        ...(plan?.stages.map(stage => harnessRoleLabel(stage.role)) || []),
      ].join(" / ")
    : "";
  return (
    <div className="relative pb-4 pl-4">
      <span className="absolute -left-[21px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-white">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: routing
              ? "var(--oc-accent)"
              : isRun
                ? "#16a34a"
                : "var(--oc-text-tertiary)",
          }}
        />
      </span>
      <details className="group" open={routing || isRun}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div
              className="truncate text-xs font-medium"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              编排器 · 任务理解
            </div>
            <div
              className="mt-0.5 truncate text-[11px]"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {routing
                ? "识别中"
                : isRun
                  ? hasControlledDataStage(plan)
                    ? `准备数据 + ${plan?.stages?.length || 0} 个 Agent 阶段${roleText ? ` · ${roleText}` : ""}`
                    : `拆分给 ${stageCount || 1} 个阶段${roleText ? ` · ${roleText}` : ""}`
                  : "需要补充信息"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {routing ? (
              <Loader2
                size={13}
                className="animate-spin"
                style={{ color: "var(--oc-accent)" }}
              />
            ) : (
              <Sparkles size={13} style={{ color: "var(--oc-accent)" }} />
            )}
            <ChevronDown
              size={14}
              className="transition group-open:rotate-180"
              style={{ color: "var(--oc-text-tertiary)" }}
            />
          </div>
        </summary>
        <div
          className="mt-2 space-y-1.5 text-[11px] leading-5"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          {summary ? <div>{summary}</div> : null}
          {isRun && plan?.templateId ? (
            <div>选择流程：{harnessTemplateLabel(plan.templateId)}</div>
          ) : null}
          {isRun && roleText ? <div>执行分工：{roleText}</div> : null}
        </div>
      </details>
    </div>
  );
}

function RunningStageCard({
  stage,
  index,
}: {
  stage: TaskTemplate["stages"][number];
  index: number;
}) {
  const displayPersona = displayPersonaId(stage.personaId);
  const steps = PERSONA_STEPS[displayPersona] || [
    "理解任务",
    "执行分析",
    "整理结果",
  ];
  const isFirst = index === 0;
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: isFirst ? "var(--oc-accent)" : "#475569" }}
        >
          {personaInitial(displayPersona)}
        </div>
        <div
          className="mt-2 h-full min-h-14 w-px"
          style={{ background: "var(--oc-border)" }}
        />
      </div>
      <div
        className="mb-4 flex-1 rounded-3xl border p-4"
        style={{
          borderColor: "var(--oc-border)",
          background: "var(--oc-card)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">
              {personaLabel({ personaId: displayPersona })}
            </div>
            <div
              className="mt-1 text-xs"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {stage.displayName}
            </div>
          </div>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{
              background:
                "color-mix(in oklab, var(--oc-accent) 10%, transparent)",
              color: "var(--oc-accent)",
            }}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在执行
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((item, stepIndex) => (
            <div
              key={item}
              className="rounded-2xl border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--oc-border)",
                background:
                  stepIndex === 0
                    ? "color-mix(in oklab, var(--oc-accent) 7%, var(--oc-card))"
                    : "var(--oc-bg-soft)",
                color: "var(--oc-text-secondary)",
              }}
            >
              {stepIndex === 0 ? "进行中 · " : "等待 · "}
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceSearchPlanCard({
  metadata,
}: {
  metadata?: Record<string, unknown>;
}) {
  const sourceResearch = normalizeResearchMetadata(metadata);
  const plan = sourceResearch.searchPlan;
  if (!hasResearchDetails(metadata) || !plan) return null;
  const queries: string[] = Array.isArray(plan.queries)
    ? plan.queries
        .map((item: unknown) => String(item))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const hints: string[] = Array.isArray(plan.officialSourceHints)
    ? plan.officialSourceHints
        .map((item: unknown) => String(item))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const normalized =
    plan.normalizedQuery?.canonicalQuery ||
    sourceResearch?.normalizedQuery?.canonicalQuery;
  const planner = plan.planner || {};
  const plannerLabel =
    planner.mode === "lingxia-llm"
      ? `LLM 搜索规划${planner.provider ? ` · ${planner.provider}` : ""}${planner.model ? ` · ${planner.model}` : ""}`
      : "规则搜索规划";

  return (
    <details
      className="mt-4 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "var(--oc-border)",
        background: "var(--oc-bg-soft)",
      }}
      open
    >
      <summary
        className="cursor-pointer select-none text-xs font-semibold"
        style={{ color: "var(--oc-text-primary)" }}
      >
        搜索规划 · {plannerLabel}
      </summary>
      <div
        className="mt-3 space-y-3 text-xs leading-6"
        style={{ color: "var(--oc-text-secondary)" }}
      >
        {plan.rationale ? <div>{String(plan.rationale)}</div> : null}
        {normalized ? (
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span
              className="font-medium"
              style={{ color: "var(--oc-text-primary)" }}
            >
              聚焦问题：
            </span>
            {String(normalized)}
          </div>
        ) : null}
        {hints.length ? (
          <div className="flex flex-wrap gap-2">
            {hints.map(hint => (
              <span key={hint} className="rounded-full bg-white/80 px-2.5 py-1">
                官方/一手源：{hint}
              </span>
            ))}
          </div>
        ) : null}
        {queries.length ? (
          <ol className="space-y-1">
            {queries.map((query, index) => (
              <li
                key={`${query}-${index}`}
                className="rounded-xl bg-white/70 px-3 py-1.5"
              >
                <span
                  className="mr-2 font-mono text-[10px]"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
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
  return (
    {
      source_of_record: "一手依据",
      corroboration: "交叉佐证",
      context: "背景材料",
      commentary: "观点参考",
    }[role || ""] ||
    role ||
    "未分级"
  );
}

function confidenceLabel(confidence?: string) {
  return (
    {
      high: "高置信",
      medium: "中置信",
      low: "低置信",
    }[confidence || ""] || "待评估"
  );
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function SourceResearchSummaryCard({
  metadata,
  onOpenDetails,
}: {
  metadata?: Record<string, unknown>;
  onOpenDetails: (metadata: Record<string, unknown>) => void;
}) {
  const sourceResearch = normalizeResearchMetadata(metadata);
  const plan = sourceResearch.searchPlan;
  if (!hasResearchDetails(metadata) || !plan) return null;
  const queries = asArray(plan.queries)
    .map(item => String(item))
    .filter(Boolean);
  const sourceHunt = plan.sourceHunt || {};
  const sources = asArray(sourceResearch.sources);
  const discarded = asArray(sourceResearch.discardedSources);
  const summary = sourceResearch.evidenceSummary || {};
  const missingInfo = asArray(sourceResearch.missingInformation)
    .map(item => String(item))
    .filter(Boolean);
  const normalized =
    plan.normalizedQuery?.canonicalQuery ||
    sourceResearch?.normalizedQuery?.canonicalQuery;
  const planner = plan.planner || {};
  const plannerLabel =
    planner.mode === "lingxia-llm"
      ? `LLM 搜索规划${planner.provider ? ` · ${planner.provider}` : ""}${planner.model ? ` · ${planner.model}` : ""}`
      : "规则搜索规划";
  const topSources = sources.slice(0, 3);
  const providers = asArray(sourceResearch.searchProviders)
    .map(item => String(item))
    .filter(Boolean);
  const searchResultCount =
    typeof sourceResearch.searchResultCount === "number"
      ? sourceResearch.searchResultCount
      : sources.length;

  return (
    <div
      className="mt-4 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "var(--oc-border)",
        background: "var(--oc-bg-soft)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--oc-text-primary)" }}
          >
            资料检索概览 · {confidenceLabel(sourceResearch.confidence)}
          </div>
          <div
            className="mt-1 text-xs"
            style={{ color: "var(--oc-text-tertiary)" }}
          >
            {plannerLabel} ·{" "}
            {sourceHunt.type ? `Source Hunt: ${sourceHunt.type}` : "开放检索"}
            {providers.length ? ` · ${providers.join(" / ")}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenDetails(metadata || {})}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{
            background: "var(--oc-card)",
            color: "var(--oc-text-primary)",
            border: "1px solid var(--oc-border)",
          }}
        >
          查看全部来源
        </button>
      </div>

      <div
        className="mt-3 grid gap-2 text-xs sm:grid-cols-5"
        style={{ color: "var(--oc-text-secondary)" }}
      >
        <div className="rounded-xl bg-white/70 px-3 py-2">
          一手 {summary.sourceOfRecordCount || 0}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          佐证 {summary.corroborationCount || 0}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          背景 {summary.contextCount || 0}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          参考 {summary.commentaryCount || 0}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          过滤 {discarded.length || summary.discardedCount || 0}
        </div>
      </div>

      <div
        className="mt-3 space-y-3 text-xs leading-6"
        style={{ color: "var(--oc-text-secondary)" }}
      >
        {normalized ? (
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span
              className="font-medium"
              style={{ color: "var(--oc-text-primary)" }}
            >
              聚焦问题：
            </span>
            {String(normalized)}
          </div>
        ) : null}
        {topSources.length ? (
          <div className="space-y-1">
            {topSources.map(source => (
              <div
                key={source.sourceId || source.url}
                className="rounded-xl bg-white/70 px-3 py-2"
              >
                <span
                  className="mr-2 font-mono text-[10px]"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  {source.sourceId || "src"}
                </span>
                <span
                  className="font-medium"
                  style={{ color: "var(--oc-text-primary)" }}
                >
                  {sourceRoleLabel(source.evidenceRole)}
                </span>
                <span className="mx-2">·</span>
                <span>{source.title}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!topSources.length && (queries.length || searchResultCount) ? (
          <div
            className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-xs leading-5"
            style={{ color: "var(--oc-text-secondary)" }}
          >
            已规划 {queries.length} 条检索，命中 {searchResultCount} 条来源。
            完整 query、资料包摘要和检索异常请在右侧详情查看。
          </div>
        ) : null}
        {missingInfo.length ? (
          <div
            className="rounded-xl border px-3 py-2"
            style={{
              borderColor: "rgba(180,83,9,0.24)",
              background: "rgba(245,158,11,0.08)",
              color: "#92400e",
            }}
          >
            <div className="font-medium">{"\u8bc1\u636e\u7f3a\u53e3"}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {missingInfo.slice(0, 3).map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {queries.length ? (
          <div style={{ color: "var(--oc-text-tertiary)" }}>
            已规划 {queries.length} 条检索；完整
            query、来源分层和过滤原因请在右侧详情查看。
          </div>
        ) : null}
      </div>
    </div>
  );
}

function countSchemaItems(payload: any) {
  if (!payload || typeof payload !== "object") return 0;
  if (Array.isArray(payload.facts)) return payload.facts.length;
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.news_items)) return payload.news_items.length;
  return 0;
}

function HarnessStageSummaryCard({
  metadata,
}: {
  metadata?: Record<string, unknown>;
}) {
  if (!metadata?.remoteHarness) return null;
  const schemaErrors = asArray(metadata.schemaErrors)
    .map(item => String(item))
    .filter(Boolean);
  const schemaPayload = metadata.schemaPayload as any;
  const missing = asArray(schemaPayload?.missing_information)
    .map(item => String(item))
    .filter(Boolean);
  const skillRefs = asArray(metadata.skillRefs)
    .map(item => String(item))
    .filter(Boolean);
  const providers = asArray(metadata.searchProviders)
    .map(item => String(item))
    .filter(Boolean);
  const attemptedProviders = asArray(metadata.searchProvidersAttempted)
    .map(item => String(item))
    .filter(Boolean);
  const searchErrors = asArray(metadata.searchErrors)
    .map(item => String(item))
    .filter(Boolean);
  const searchResultCount =
    typeof metadata.searchResultCount === "number"
      ? metadata.searchResultCount
      : 0;
  const permissionPolicy = (metadata.permissionPolicy || {}) as any;
  const allowedTools = asArray(permissionPolicy.allowedTools)
    .map(item => String(item))
    .filter(Boolean);
  const allowedMcpServers = asArray(permissionPolicy.allowedMcpServers)
    .map(item => String(item))
    .filter(Boolean);
  const policyWarnings = asArray(permissionPolicy.warnings)
    .map(item => String(item))
    .filter(Boolean);
  const policyErrors = asArray(permissionPolicy.errors)
    .map(item => String(item))
    .filter(Boolean);
  const hasSchema = Boolean(metadata.schemaRef);
  const schemaPassed = hasSchema && schemaErrors.length === 0;
  const itemCount = countSchemaItems(schemaPayload);
  const writeAllowed = Boolean(permissionPolicy.writeAllowed);
  const searchAllowed = Boolean(permissionPolicy.externalSearchAllowed);
  const artifactType =
    typeof metadata.artifactType === "string" ? metadata.artifactType : "";

  if (
    !hasSchema &&
    !providers.length &&
    !attemptedProviders.length &&
    !skillRefs.length &&
    !allowedTools.length &&
    !allowedMcpServers.length
  )
    return null;

  return (
    <div
      className="mt-4 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "var(--oc-border)",
        background: "var(--oc-bg-soft)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--oc-text-primary)" }}
          >
            {"\u53d7\u63a7\u6267\u884c"}
          </div>
          <div
            className="mt-1 text-[11px]"
            style={{ color: "var(--oc-text-tertiary)" }}
          >
            {searchAllowed
              ? "\u68c0\u7d22\u5458\u53ef\u641c\u7d22\u516c\u5f00\u6570\u636e"
              : "\u672c\u9636\u6bb5\u4e0d\u76f4\u63a5\u5916\u641c"}
            {" \u00b7 "}
            {writeAllowed
              ? "\u5141\u8bb8\u5199\u5165\u4ea7\u7269"
              : "\u7981\u6b62\u5199\u5165"}
          </div>
        </div>
        {hasSchema ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{
              background: schemaPassed
                ? "rgba(22,163,74,0.10)"
                : "rgba(220,38,38,0.10)",
              color: schemaPassed ? "#15803d" : "#b91c1c",
            }}
          >
            {schemaPassed ? (
              <CheckCircle2 size={13} />
            ) : (
              <AlertTriangle size={13} />
            )}
            {schemaPassed
              ? "\u7ed3\u6784\u5316\u6821\u9a8c\u901a\u8fc7"
              : "\u7ed3\u6784\u5316\u6821\u9a8c\u5f02\u5e38"}
          </span>
        ) : null}
        {artifactType ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium"
            style={{ color: "var(--oc-text-secondary)" }}
          >
            {"\u4ea7\u7269 " + artifactType.toUpperCase()}
          </span>
        ) : null}
      </div>

      <div
        className="mt-3 grid gap-2 text-xs sm:grid-cols-3"
        style={{ color: "var(--oc-text-secondary)" }}
      >
        <div className="rounded-xl bg-white/70 px-3 py-2">
          {"\u641c\u7d22\u6765\u6e90 " + searchResultCount}
          {providers.length ? (
            <span className="ml-1" style={{ color: "var(--oc-text-tertiary)" }}>
              {"\u00b7 "}
              {providers.join(" / ")}
            </span>
          ) : null}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          {"\u7ed3\u6784\u5316\u6761\u76ee " + itemCount}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          {"\u7f3a\u5931\u4fe1\u606f " + missing.length}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          {"\u5199\u5165\u6743\u9650 " +
            (writeAllowed ? "\u5141\u8bb8" : "\u7981\u6b62")}
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2 sm:col-span-2">
          {"\u5de5\u5177 " +
            (allowedTools.length
              ? allowedTools.join(" / ")
              : "\u672a\u58f0\u660e")}
        </div>
      </div>

      {skillRefs.length || allowedMcpServers.length ? (
        <div
          className="mt-2 flex flex-wrap gap-1.5 text-[11px]"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          {skillRefs.map(skill => (
            <span key={skill} className="rounded-full bg-white/70 px-2.5 py-1">
              skill: {skill}
            </span>
          ))}
          {allowedMcpServers.map(server => (
            <span key={server} className="rounded-full bg-white/70 px-2.5 py-1">
              mcp: {server}
            </span>
          ))}
        </div>
      ) : null}

      {schemaErrors.length ||
      searchErrors.length ||
      missing.length ||
      policyWarnings.length ||
      policyErrors.length ? (
        <details
          className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          <summary
            className="cursor-pointer select-none font-medium"
            style={{ color: "var(--oc-text-primary)" }}
          >
            {"\u67e5\u770b\u6821\u9a8c\u4e0e\u7f3a\u5931\u4fe1\u606f"}
          </summary>
          <div className="mt-2 space-y-1 leading-5">
            {schemaErrors.map(item => (
              <div key={"schema-" + item}>schema: {item}</div>
            ))}
            {searchErrors.map(item => (
              <div key={"search-" + item}>search: {item}</div>
            ))}
            {missing.map(item => (
              <div key={"missing-" + item}>missing: {item}</div>
            ))}
            {policyWarnings.map(item => (
              <div key={"policy-warning-" + item}>policy warning: {item}</div>
            ))}
            {policyErrors.map(item => (
              <div key={"policy-error-" + item}>policy error: {item}</div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function StageOutputSummaryCard({
  role,
  text,
  metadata,
  compact = false,
}: {
  role: string;
  text: string;
  metadata?: Record<string, unknown>;
  compact?: boolean;
}) {
  const mode = stageOutputMode(role);
  if (mode !== "evidence" && mode !== "analysis") return null;

  const schemaPayload = metadata?.schemaPayload as any;
  const parsed = parseJsonObject(text);
  const providers = asArray(metadata?.searchProviders)
    .map(item => String(item))
    .filter(Boolean);
  const attemptedProviders = asArray(metadata?.searchProvidersAttempted)
    .map(item => String(item))
    .filter(Boolean);
  const providerRows = providers.length ? providers : attemptedProviders;
  const missing = stringList(
    schemaPayload?.missing_information || parsed?.missing_information,
    3
  );
  const evidenceRows = asArray(
    schemaPayload?.facts || schemaPayload?.items || schemaPayload?.news_items
  )
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const object = item as Record<string, unknown>;
      return {
        claim: String(
          object.claim || object.title || object.summary || ""
        ).trim(),
        source: String(
          object.source || object.publisher || object.url || ""
        ).trim(),
        confidence: String(
          object.confidence || object.sourceQuality || ""
        ).trim(),
      };
    })
    .filter(
      (item): item is { claim: string; source: string; confidence: string } =>
        Boolean(item?.claim)
    )
    .slice(0, 3);

  const findingRows = stringList(
    parsed?.core_findings ||
      parsed?.findings ||
      parsed?.key_findings ||
      parsed?.analysis_points ||
      parsed?.writer_outline,
    3
  );
  const riskRows = stringList(
    parsed?.risks ||
      parsed?.risk_flags ||
      parsed?.uncertainties ||
      parsed?.missing_information,
    3
  );
  const fallbackLines = text
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(line => line && !line.startsWith("{") && !line.endsWith("}"))
    .slice(0, 3);

  const title = mode === "evidence" ? "证据包摘要" : "分析摘要";
  const detailTitle = mode === "evidence" ? "查看证据包" : "查看分析草稿";
  const rows =
    mode === "evidence"
      ? evidenceRows.map(item => item.claim)
      : findingRows.length
        ? findingRows
        : fallbackLines;
  const rawText = stripCodeFence(text);

  if (compact) {
    return (
      <details
        className="mt-2 rounded-xl px-2.5 py-2 text-[11px]"
        style={{
          background:
            "color-mix(in oklab, var(--oc-bg-surface) 48%, transparent)",
          color: "var(--oc-text-tertiary)",
        }}
      >
        <summary
          className="cursor-pointer select-none"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          {title}
          {rows.length ? ` · ${rows.length} 条` : ""}
        </summary>
        {rows.length && mode !== "evidence" ? (
          <div className="mt-2 space-y-1.5">
            {rows.slice(0, 3).map((item, index) => (
              <div key={`${item}-${index}`} className="leading-5">
                {index + 1}. {item}
              </div>
            ))}
          </div>
        ) : null}
        {mode === "evidence" && evidenceRows.length ? (
          <div className="mt-2 space-y-1.5">
            {evidenceRows.slice(0, 3).map((item, index) => (
              <div
                key={`${item.source}-${index}`}
                className="rounded-lg bg-white/60 px-2 py-1.5 leading-5"
              >
                <div style={{ color: "var(--oc-text-secondary)" }}>
                  {item.claim}
                </div>
                {item.source ? (
                  <div
                    className="mt-0.5 truncate"
                    style={{ color: "var(--oc-text-tertiary)" }}
                  >
                    来源：{item.source}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </details>
    );
  }

  return (
    <div
      className="mt-4 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "var(--oc-border)",
        background: "var(--oc-bg-soft)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--oc-text-primary)" }}
          >
            {title}
          </div>
          <div
            className="mt-1 text-[11px]"
            style={{ color: "var(--oc-text-tertiary)" }}
          >
            {mode === "evidence"
              ? `结构化证据 ${countSchemaItems(schemaPayload)} 条${providerRows.length ? ` · ${providerRows.join(" / ")}` : ""}`
              : `核心判断 ${rows.length} 条 · 风险/缺失 ${riskRows.length + missing.length} 条`}
          </div>
        </div>
        <span
          className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          {mode === "evidence" ? "Reader" : "Analyst"}
        </span>
      </div>

      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="rounded-xl bg-white/75 px-3 py-2 text-xs leading-5"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              <span
                className="mr-2 font-mono text-[10px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              {item}
              {mode === "evidence" && evidenceRows[index]?.source ? (
                <span
                  className="ml-2"
                  style={{ color: "var(--oc-text-tertiary)" }}
                >
                  · {evidenceRows[index].source}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-xs"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          已完成本阶段，详细输出已折叠保留。
        </div>
      )}

      {riskRows.length || missing.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...riskRows, ...missing].slice(0, 4).map(item => (
            <span
              key={item}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{ background: "rgba(245,158,11,0.10)", color: "#92400e" }}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {rawText ? (
        <details
          className="mt-3 rounded-xl bg-white/75 px-3 py-2 text-xs"
          style={{ color: "var(--oc-text-secondary)" }}
        >
          <summary
            className="cursor-pointer select-none font-medium"
            style={{ color: "var(--oc-text-primary)" }}
          >
            {detailTitle}
          </summary>
          <pre
            className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[11px] leading-5"
            style={{
              background: "var(--oc-card)",
              color: "var(--oc-text-secondary)",
            }}
          >
            {rawText}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ExecutionPlanBar({
  selected,
  decision,
  liveStages,
  run,
}: {
  selected: TaskTemplate | null;
  decision: RouterDecision | null;
  liveStages: LiveStageState[];
  run: TaskRun | null;
}) {
  const controlledDataPlanned = hasControlledDataStage(decision?.harnessPlan);
  const planStages = decision?.harnessPlan?.stages?.length
    ? [
        ...(controlledDataPlanned
          ? [
              {
                key: CONTROLLED_DATA_STAGE_ID,
                label: "准备数据",
                role: "数据准备",
                profile: "employee-agent",
              },
            ]
          : []),
        ...decision.harnessPlan.stages.map(stage => ({
        key: stage.stageId,
        label: workflowStepLabel(stage.role.toLowerCase()),
        role: stage.role,
        profile: stage.profile,
        })),
      ]
    : selected?.stages.map(stage => ({
        key: stage.id,
        label: workflowStepLabel(
          displayStageRole(stage.personaId, stage.agentDefinitionId)
        ),
        role: personaShortLabel(stage.personaId).split("·")[0].trim(),
        profile: stage.agentDefinitionId,
      })) || [];

  if (!planStages.length) return null;
  const stageCount = planStages.length;

  const statusByStage = new Map<string, string>();
  liveStages.forEach(stage => statusByStage.set(stage.stageId, stage.status));
  run?.stages?.forEach(stage =>
    statusByStage.set(
      stage.stageId,
      stage.status === "success" ? "success" : stage.status
    )
  );

  return (
    <section
      className="mt-6 rounded-[28px] border bg-white p-4 shadow-sm"
      style={{ borderColor: "var(--oc-border)" }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">执行计划</div>
          <div
            className="mt-1 text-xs"
            style={{ color: "var(--oc-text-tertiary)" }}
          >
            {controlledDataPlanned
              ? `受控取数 + ${Math.max(stageCount - 1, 0)} 个 Agent 阶段`
              : `自动编排 ${stageCount} 个执行阶段`}
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{
            background: "var(--oc-bg-soft)",
            color: "var(--oc-text-secondary)",
          }}
        >
          {taskDisplayName(selected)}
        </span>
      </div>
      <div
        className={
          stageCount === 1
            ? "grid gap-2"
            : stageCount === 2
              ? "grid gap-2 md:grid-cols-2"
              : "grid gap-2 md:grid-cols-3"
        }
      >
        {planStages.map((item, index) => {
          const status = statusByStage.get(item.key) || "waiting";
          const meta = statusMeta(status);
          const Icon = meta.icon;
          return (
            <div
              key={item.key}
              className="rounded-2xl border px-3 py-3"
              style={{
                borderColor: "var(--oc-border)",
                background: "var(--oc-bg-soft)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ background: "var(--oc-accent)" }}
                >
                  {index + 1}
                </span>
                <Icon
                  size={14}
                  style={{ color: meta.color }}
                  className={status === "running" ? "animate-spin" : undefined}
                />
              </div>
              <div className="mt-3 text-sm font-semibold">{item.label}</div>
              <div
                className="mt-1 truncate text-[11px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {item.role} · {item.profile}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LiveStageCard({
  stage,
  onPreview,
  onOpenResearch,
  compact = false,
}: {
  stage: LiveStageState;
  onPreview: (artifact: Artifact) => void;
  onOpenResearch: (title: string, metadata: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const meta = statusMeta(stage.status);
  const Icon = meta.icon;
  const hasArtifacts = Boolean(stage.artifacts?.length);
  const displayArtifacts = preferredDisplayArtifacts(stage.artifacts || []);
  const hasDisplayArtifacts = displayArtifacts.length > 0;
  const role = displayStageRole(
    stage.personaId,
    stage.agentDefinitionId,
    stage.runResult?.metadata
  );
  const outputMode = stageOutputMode(role);
  const rawText =
    stage.text || stage.runResult?.output || stage.runResult?.summary || "";
  const text = cleanText(rawText);
  const researchMetadata = {
    ...(stage.runResult?.metadata || {}),
    __output: rawText,
  } as Record<string, unknown>;
  const hasSourceResearch = hasResearchDetails(researchMetadata);
  const preview =
    stage.status === "running" &&
    outputMode !== "evidence" &&
    outputMode !== "analysis"
      ? text.slice(0, 420)
      : "";
  const finalText =
    stage.status !== "running" &&
    outputMode !== "evidence" &&
    outputMode !== "analysis" &&
    !hasSourceResearch &&
    (!hasDisplayArtifacts || role === "writer")
      ? text
      : "";
  const defaultOpen = compact
    ? stage.status !== "waiting"
    : stage.status === "running" ||
      outputMode === "final" ||
      stage.status === "failed" ||
      stage.status === "timeout";
  const [expanded, setExpanded] = useState(defaultOpen);
  if (compact) {
    const insights = compactInsightRows(
      role,
      rawText,
      stage.runResult?.metadata,
      role === "reader" ? 6 : 6
    );
    const searches =
      role === "reader" ? compactSearchRows(stage.runResult?.metadata, 8) : [];
    const sourceResearch = hasResearchDetails(researchMetadata);
    return (
      <div className="relative pb-4 pl-4">
        <span className="absolute -left-[21px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-white">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background:
                stage.status === "success"
                  ? "#16a34a"
                  : stage.status === "running"
                    ? "var(--oc-accent)"
                    : "var(--oc-text-tertiary)",
            }}
          />
        </span>
        <details
          className="group"
          open={expanded}
          onToggle={event => setExpanded(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <div
                className="truncate text-xs font-medium"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                {compactStageTitle(stage, role)}
              </div>
              <div
                className="mt-0.5 truncate text-[11px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {stage.status === "running" ? "运行中" : meta.label}
                {stage.durationMs
                  ? ` · ${formatDuration(stage.durationMs)}`
                  : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Icon
                size={13}
                style={{ color: meta.color }}
                className={
                  stage.status === "running" ? "animate-spin" : undefined
                }
              />
              <ChevronDown
                size={14}
                className="transition group-open:rotate-180"
                style={{ color: "var(--oc-text-tertiary)" }}
              />
            </div>
          </summary>
          <div className="mt-2 pl-1">
            {stage.status === "running" && !stage.events.length ? (
              <div
                className="mb-2 text-xs leading-6"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                {role === "data"
                  ? "正在按权限调取数据并生成受控数据包..."
                  : role === "reader"
                  ? "正在检索和筛选公开资料..."
                  : role === "analyst"
                    ? "正在阅读证据包并形成判断..."
                    : "正在整理最终交付内容..."}
              </div>
            ) : null}
            {stage.events.length ? (
              <div className="flex flex-wrap gap-1.5">
                {stage.events.slice(-4).map((event, index) => (
                  <div
                    key={`${event}-${index}`}
                    className="inline-flex max-w-full items-center rounded-full px-2 py-1 text-[11px] leading-4"
                    style={{
                      background:
                        "color-mix(in oklab, var(--oc-text-secondary) 7%, transparent)",
                      color: "var(--oc-text-secondary)",
                    }}
                  >
                    <span className="truncate">{event}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="text-[11px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {stage.status === "waiting" ? "等待上游完成" : "正在启动"}
              </div>
            )}
            {searches.length ? (
              <div className="mt-2 space-y-1.5">
                {searches.map((query, index) => (
                  <div
                    key={`${query}-${index}`}
                    className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px]"
                    style={{
                      background:
                        "color-mix(in oklab, var(--oc-text-secondary) 7%, transparent)",
                      color: "var(--oc-text-secondary)",
                    }}
                  >
                    <Search size={11} className="mr-1 shrink-0" />
                    <span className="truncate">{query}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {stage.status !== "running" && insights.length ? (
              <div
                className="mt-2 space-y-1.5 text-xs leading-6"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                {insights.map((item, index) => (
                  <div key={`${item}-${index}`}>{item}</div>
                ))}
              </div>
            ) : null}
            {stage.status !== "running" && sourceResearch ? (
              <button
                type="button"
                onClick={() =>
                  onOpenResearch(
                    personaLabel(stage),
                    researchMetadata
                  )
                }
                className="mt-2 rounded-full px-2.5 py-1 text-[11px]"
                style={{
                  background:
                    "color-mix(in oklab, var(--oc-text-secondary) 8%, transparent)",
                  color: "var(--oc-text-secondary)",
                }}
              >
                查看来源与检索细节
              </button>
            ) : null}
            {role === "writer" && text ? (
              <article
                className="mt-3 rounded-xl bg-white/80 px-4 py-3 text-[13px] leading-6 shadow-sm"
                style={{ color: "var(--oc-text-primary)" }}
              >
                <MarkdownContent text={text} compact />
              </article>
            ) : null}
            {hasArtifacts && stage.status !== "running" ? (
              <div className="mt-2 grid gap-2">
                {displayArtifacts.map(artifact => (
                  <ArtifactDisplayCard
                    key={artifact.id}
                    artifact={artifact}
                    onPreview={onPreview}
                  />
                ))}
              </div>
            ) : null}
            {stage.error ? (
              <div className="mt-2 text-xs text-red-600">{stage.error}</div>
            ) : null}
          </div>
        </details>
      </div>
    );
  }
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <PersonaAvatar
          personaId={stage.personaId}
          failed={stage.status === "failed" || stage.status === "timeout"}
        />
        <div
          className="mt-2 h-full min-h-14 w-px"
          style={{ background: "var(--oc-border)" }}
        />
      </div>
      <div className="mb-6 flex-1">
        <details
          className="group rounded-3xl border p-5"
          style={{
            borderColor: "var(--oc-border)",
            background: "var(--oc-card)",
          }}
          open={expanded}
          onToggle={event => setExpanded(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <div>
              <div className="text-sm font-semibold">
                {workflowStepLabel(role)} · {personaLabel(stage)}
              </div>
              <div
                className="mt-1 text-xs"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {stage.displayName || stage.agentDefinitionId}{" "}
                {stage.durationMs
                  ? `· ${formatDuration(stage.durationMs)}`
                  : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
                style={{ background: "var(--oc-muted)", color: meta.color }}
              >
                <Icon
                  size={14}
                  className={
                    stage.status === "running" ? "animate-spin" : undefined
                  }
                />
                {meta.label}
              </span>
              <ChevronDown
                size={16}
                className="transition group-open:rotate-180"
                style={{ color: "var(--oc-text-tertiary)" }}
              />
            </div>
          </summary>

          <div className="mt-4">
            {stage.events.length ? (
              <details
                className="rounded-2xl border px-3 py-2"
                style={{
                  borderColor: "var(--oc-border)",
                  background: "var(--oc-bg-soft)",
                }}
                open={stage.status === "running"}
              >
                <summary
                  className="cursor-pointer select-none text-xs font-medium"
                  style={{ color: "var(--oc-text-secondary)" }}
                >
                  执行轨迹 · {stage.events.length} 条
                </summary>
                <div className="mt-2 space-y-1">
                  {stage.events.map((event, index) => (
                    <div
                      key={`${event}-${index}`}
                      className="flex items-start gap-2 rounded-xl bg-white/70 px-2.5 py-1.5 text-[11px] leading-5"
                      style={{ color: "var(--oc-text-secondary)" }}
                    >
                      <span
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                        style={{
                          background:
                            stage.status === "running"
                              ? "var(--oc-accent)"
                              : "var(--oc-text-tertiary)",
                        }}
                      />
                      <span className="min-w-0">{event}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{
                  background: "var(--oc-bg-soft)",
                  color: "var(--oc-text-tertiary)",
                }}
              >
                {stage.status === "waiting"
                  ? "等待上游专员完成..."
                  : "正在启动专员..."}
              </div>
            )}

            <SourceResearchSummaryCard
              metadata={stage.runResult?.metadata}
              onOpenDetails={metadata =>
                onOpenResearch(personaLabel(stage), metadata)
              }
            />
            <HarnessStageSummaryCard metadata={stage.runResult?.metadata} />
            {stage.status !== "running" ? (
              <StageOutputSummaryCard
                role={role}
                text={rawText}
                metadata={stage.runResult?.metadata}
              />
            ) : null}

            {preview ? (
              <div
                className="mt-4 rounded-2xl border px-4 py-3 text-sm leading-7"
                style={{
                  borderColor: "var(--oc-border)",
                  color: "var(--oc-text-secondary)",
                }}
              >
                <div className="whitespace-pre-wrap">{preview}</div>
              </div>
            ) : null}

            {hasArtifacts && stage.status !== "running" ? (
              <div
                className="mt-4 rounded-2xl border px-4 py-3 text-sm leading-6"
                style={{
                  borderColor: "var(--oc-border)",
                  background: "var(--oc-bg-soft)",
                  color: "var(--oc-text-secondary)",
                }}
              >
                已生成交付文件。点击文件卡的「预览」会在右侧打开，过程区只保留执行轨迹，避免和最终产物重复。
              </div>
            ) : null}

            {displayArtifacts.length ? (
              <div className="mt-3 grid gap-3">
                {displayArtifacts.map(artifact => (
                  <ArtifactDisplayCard
                    key={artifact.id}
                    artifact={artifact}
                    onPreview={onPreview}
                  />
                ))}
              </div>
            ) : null}

            {stage.error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {stage.error}
              </div>
            ) : null}

            {finalText ? (
              <article className="mt-6 max-w-none px-1 pb-2">
                <MarkdownContent text={finalText} />
              </article>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

function AgentMessageCard({
  stage,
  artifacts,
  onPreview,
  onOpenResearch,
  compact = false,
}: {
  stage: TaskStageResult;
  artifacts: Artifact[];
  onPreview: (artifact: Artifact) => void;
  onOpenResearch: (title: string, metadata: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const meta = statusMeta(stage.status);
  const Icon = meta.icon;
  const researchMetadata = {
    ...(stage.runResult?.metadata || {}),
    __output: stage.runResult?.output || stage.runResult?.summary || "",
  } as Record<string, unknown>;
  const hasSourceResearch = hasResearchDetails(researchMetadata);
  const displayArtifacts = preferredDisplayArtifacts(artifacts);
  const hasDisplayArtifacts = displayArtifacts.length > 0;
  const role = displayStageRole(
    stage.personaId,
    stage.agentDefinitionId,
    stage.runResult?.metadata
  );
  const outputMode = stageOutputMode(role);
  const rawOutput = stage.runResult?.output || stage.runResult?.summary || "";
  const output =
    hasSourceResearch ||
    outputMode === "evidence" ||
    outputMode === "analysis" ||
    (hasDisplayArtifacts && role !== "writer")
      ? ""
      : cleanText(rawOutput);
  const errorText =
    stage.runResult?.error?.detail || stage.runResult?.error?.code;
  const defaultOpen = compact
    ? true
    : outputMode === "final" || stage.status !== "success";
  const [expanded, setExpanded] = useState(defaultOpen);
  if (compact) {
    const insights = compactInsightRows(
      role,
      rawOutput,
      stage.runResult?.metadata,
      role === "reader" ? 6 : 6
    );
    const searches =
      role === "reader" ? compactSearchRows(stage.runResult?.metadata, 8) : [];
    const sourceResearch = hasResearchDetails(researchMetadata);
    return (
      <div className="relative pb-4 pl-4">
        <span className="absolute -left-[21px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-white">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: stage.status === "success" ? "#16a34a" : "#dc2626",
            }}
          />
        </span>
        <details
          className="group"
          open={expanded}
          onToggle={event => setExpanded(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <div
                className="truncate text-xs font-medium"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                {compactStageTitle(stage, role)}
              </div>
              <div
                className="mt-0.5 truncate text-[11px]"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {meta.label} · {formatDuration(stage.durationMs)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Icon size={13} style={{ color: meta.color }} />
              <ChevronDown
                size={14}
                className="transition group-open:rotate-180"
                style={{ color: "var(--oc-text-tertiary)" }}
              />
            </div>
          </summary>
          <div className="mt-2">
            {searches.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {searches.map((query, index) => (
                  <div
                    key={`${query}-${index}`}
                    className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px]"
                    style={{
                      background:
                        "color-mix(in oklab, var(--oc-text-secondary) 7%, transparent)",
                      color: "var(--oc-text-secondary)",
                    }}
                  >
                    <Search size={11} className="mr-1 shrink-0" />
                    <span className="truncate">{query}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {insights.length ? (
              <div
                className="space-y-1.5 text-xs leading-6"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                {insights.map((item, index) => (
                  <div key={`${item}-${index}`}>{item}</div>
                ))}
              </div>
            ) : null}
            {sourceResearch ? (
              <button
                type="button"
                onClick={() =>
                  onOpenResearch(
                    personaLabel(stage),
                    researchMetadata
                  )
                }
                className="mt-2 rounded-full px-2.5 py-1 text-[11px]"
                style={{
                  background:
                    "color-mix(in oklab, var(--oc-text-secondary) 8%, transparent)",
                  color: "var(--oc-text-secondary)",
                }}
              >
                查看来源与检索细节
              </button>
            ) : null}
            {displayArtifacts.length ? (
              <div className="mt-2 grid gap-2">
                {displayArtifacts.map(artifact => (
                  <ArtifactDisplayCard
                    key={artifact.id}
                    artifact={artifact}
                    onPreview={onPreview}
                  />
                ))}
              </div>
            ) : null}
            {output ? (
              <article
                className="mt-3 max-w-none rounded-xl bg-white/80 px-4 py-3 text-[13px] leading-6 shadow-sm"
                style={{ color: "var(--oc-text-primary)" }}
              >
                <MarkdownContent text={output} compact />
              </article>
            ) : null}
            {errorText ? (
              <div className="mt-2 text-xs text-red-600">{errorText}</div>
            ) : null}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <PersonaAvatar
          personaId={stage.personaId}
          failed={stage.status !== "success"}
        />
        <div
          className="mt-2 h-full min-h-14 w-px"
          style={{ background: "var(--oc-border)" }}
        />
      </div>
      <div className="mb-6 flex-1">
        <details
          className="group rounded-3xl border p-5"
          style={{
            borderColor: "var(--oc-border)",
            background: "var(--oc-card)",
          }}
          open={expanded}
          onToggle={event => setExpanded(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <div>
              <div className="text-sm font-semibold">
                {workflowStepLabel(role)} · {personaLabel(stage)}
              </div>
              <div
                className="mt-1 text-xs"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {stage.agentDefinitionId} · {formatDuration(stage.durationMs)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
                style={{ background: "var(--oc-muted)", color: meta.color }}
              >
                <Icon size={14} />
                {meta.label}
              </span>
              <ChevronDown
                size={16}
                className="transition group-open:rotate-180"
                style={{ color: "var(--oc-text-tertiary)" }}
              />
            </div>
          </summary>

          <div className="mt-4">
            {!output && errorText ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {errorText}
              </div>
            ) : !output ? (
              <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{
                  background: "var(--oc-bg-soft)",
                  color: "var(--oc-text-tertiary)",
                }}
              >
                这个专员没有返回文字说明，但可能已经生成了产物。
              </div>
            ) : null}

            {stage.warnings?.length ? (
              <div className="mt-3 space-y-2">
                {stage.warnings.map(warning => (
                  <div
                    key={warning}
                    className="rounded-2xl border px-4 py-2 text-xs"
                    style={{
                      borderColor: "rgba(180,83,9,0.28)",
                      background: "rgba(245,158,11,0.08)",
                      color: "#92400e",
                    }}
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            <SourceResearchSummaryCard
              metadata={stage.runResult?.metadata}
              onOpenDetails={metadata =>
                onOpenResearch(personaLabel(stage), metadata)
              }
            />
            <HarnessStageSummaryCard metadata={stage.runResult?.metadata} />
            <StageOutputSummaryCard
              role={role}
              text={rawOutput}
              metadata={stage.runResult?.metadata}
            />

            {displayArtifacts.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {displayArtifacts.map(artifact => (
                  <ArtifactDisplayCard
                    key={artifact.id}
                    artifact={artifact}
                    onPreview={onPreview}
                  />
                ))}
              </div>
            ) : null}

            {output ? (
              <article className="mt-6 max-w-none px-1 pb-2">
                <MarkdownContent text={output} />
              </article>
            ) : null}
          </div>
        </details>
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
  const [tasksOpen, setTasksOpen] = useState(true);
  return (
    <aside
      className="hidden w-72 shrink-0 border-r px-4 py-5 lg:block"
      style={{
        borderColor: "var(--oc-border)",
        background: "var(--oc-bg-soft)",
      }}
    >
      <div className="mb-5 flex items-center gap-2 px-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-white"
          style={{ background: "var(--oc-accent)" }}
        >
          <Sparkles size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold">任务工作台</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            灰度验证页
          </div>
        </div>
      </div>

      <section>
        <button
          type="button"
          onClick={() => setTasksOpen(open => !open)}
          className="mb-3 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-medium uppercase tracking-[0.18em]"
          style={{ color: "var(--oc-text-tertiary)" }}
        >
          <span>预制任务</span>
          <ChevronDown
            size={14}
            className={`transition ${tasksOpen ? "rotate-0" : "-rotate-90"}`}
          />
        </button>

        {tasksOpen ? (
          loading ? (
            <div
              className="flex items-center gap-2 px-2 py-8 text-sm"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              加载任务模板...
            </div>
          ) : error && templates.length === 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(template => {
                const Icon = TASK_ICONS[template.id] || FileText;
                const active = selectedId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    disabled={running}
                    onClick={() => onChoose(template)}
                    className="relative w-full overflow-hidden rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
                    style={{
                      borderColor: active
                        ? "color-mix(in oklab, var(--oc-accent) 35%, var(--oc-border))"
                        : "var(--oc-border)",
                      background: "var(--oc-card)",
                      boxShadow: active
                        ? "0 12px 28px rgba(15,23,42,0.08)"
                        : "0 8px 18px rgba(15,23,42,0.04)",
                    }}
                  >
                    {active ? (
                      <span
                        className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full"
                        style={{ background: "var(--oc-accent)" }}
                      />
                    ) : null}
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{
                          background: active
                            ? "color-mix(in oklab, var(--oc-accent) 12%, transparent)"
                            : "var(--oc-muted)",
                          color: active
                            ? "var(--oc-accent)"
                            : "var(--oc-text-secondary)",
                        }}
                      >
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-medium">
                            {taskDisplayName(template)}
                          </div>
                          {active ? (
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background:
                                  "color-mix(in oklab, var(--oc-accent) 12%, transparent)",
                                color: "var(--oc-accent)",
                              }}
                            >
                              已选择
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="mt-1 text-xs"
                          style={{ color: "var(--oc-text-tertiary)" }}
                        >
                          预计 {formatDuration(template.estimatedDurationMs)}
                        </div>
                        <div
                          className="mt-1 line-clamp-2 text-[11px] leading-5"
                          style={{ color: "var(--oc-text-tertiary)" }}
                        >
                          {taskDescription(template)}
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
    </aside>
  );
}

export function DocumentTaskWorkbench({
  adoptId,
  apiBase = "/api/admin/task-workbench-lab",
  templateIds,
  initialTemplateId = "",
  initialPrompt = "",
  titleLabel = "Task Workbench",
  showSelector = true,
  compactOfficeMode = false,
  onBack,
}: DocumentTaskWorkbenchProps = {}) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialTemplateId);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [uploadTaskId, setUploadTaskId] = useState(makeWorkbenchTaskId);
  const [attachments, setAttachments] = useState<UploadedWorkbenchFile[]>([]);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [submittedAttachments, setSubmittedAttachments] = useState<
    UploadedWorkbenchFile[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routerDecision, setRouterDecision] = useState<RouterDecision | null>(
    null
  );
  const [run, setRun] = useState<TaskRun | null>(null);
  const [liveStages, setLiveStages] = useState<LiveStageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [researchPreview, setResearchPreview] =
    useState<ResearchPreviewState | null>(null);
  const [workDirectoryPreview, setWorkDirectoryPreview] =
    useState<WorkDirectoryPreviewState | null>(null);
  const [fullscreenPreview, setFullscreenPreview] =
    useState<PreviewState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyRecords, setHistoryRecords] = useState<TaskHistoryRecord[]>([]);
  const [pptTemplates, setPptTemplates] = useState<PptTemplateOption[]>([]);
  const [pptTemplateId, setPptTemplateId] = useState("huawei-light");
  const [pptSlideRange, setPptSlideRange] = useState("8-12");
  const [pptSlideRangeOpen, setPptSlideRangeOpen] = useState(false);
  const [hoveredPptTemplateId, setHoveredPptTemplateId] = useState<
    string | null
  >(null);
  const [pptPreviewFrame, setPptPreviewFrame] = useState(0);
  const [customPptTemplate, setCustomPptTemplate] =
    useState<UploadedWorkbenchFile | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [compactMoreOpen, setCompactMoreOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pptTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const fallbackTemplates = useMemo(() => {
    const ids = templateIds?.length
      ? templateIds
      : initialTemplateId
        ? [initialTemplateId]
        : [];
    return ids
      .map(id => localTaskTemplate(id))
      .filter(Boolean) as TaskTemplate[];
  }, [initialTemplateId, templateIds?.join("|")]);
  const availableTemplates = templates.length ? templates : fallbackTemplates;
  const selected = useMemo(
    () => availableTemplates.find(item => item.id === selectedId) || null,
    [availableTemplates, selectedId]
  );
  const SelectedTaskIcon = selected
    ? TASK_ICONS[selected.id] || FileText
    : FileText;
  const isResearchPpt = selected?.id === "research_ppt";
  const selectedPptTemplate =
    pptTemplateId === "custom"
      ? {
          id: "custom",
          name: customPptTemplate?.name || "自定义模板",
          description: customPptTemplate
            ? formatSize(customPptTemplate.size)
            : "支持 .pptx/.ppt",
        }
      : pptTemplates.find(item => item.id === pptTemplateId) || null;
  const pptSlideRangeOptions = ["4-8", "8-12", "12-16"];
  const hasConversation = Boolean(
    submittedPrompt || routing || running || routerDecision || run
  );
  const quickPrompts = selected ? TASK_QUICK_PROMPTS[selected.id] || [] : [];
  const filteredHistoryRecords = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const rows = historyRecords.filter(
      item => !selectedId || item.taskTemplateId === selectedId
    );
    if (!q) return rows;
    return rows.filter(item =>
      [item.title, item.prompt, item.status].some(value =>
        String(value || "")
          .toLowerCase()
          .includes(q)
      )
    );
  }, [historyQuery, historyRecords, selectedId]);
  const workFolderAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const stage of run?.stages || []) {
      if (/^task-/.test(stage.agentDefinitionId))
        ids.add(stage.agentDefinitionId);
    }
    return Array.from(ids);
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (adoptId) params.set("adoptId", adoptId);
    if (templateIds?.length) params.set("ids", templateIds.join(","));
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`${apiBase}/templates${query}`, { credentials: "include" })
      .then(response =>
        response.ok
          ? response.json()
          : Promise.reject(
              new Error(
                response.status === 404
                  ? "Task Workbench Lab 未开启"
                  : `HTTP ${response.status}`
              )
            )
      )
      .then(data => {
        if (cancelled) return;
        const rows = Array.isArray(data?.templates) ? data.templates : [];
        const allowed = templateIds?.length
          ? rows.filter((item: TaskTemplate) => templateIds.includes(item.id))
          : rows;
        setTemplates(allowed);
        if (
          initialTemplateId &&
          allowed.some((item: TaskTemplate) => item.id === initialTemplateId)
        ) {
          setSelectedId(initialTemplateId);
        } else if (!showSelector && allowed[0]) {
          setSelectedId(allowed[0].id);
        }
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
  }, [
    adoptId,
    apiBase,
    initialTemplateId,
    showSelector,
    templateIds?.join("|"),
  ]);

  const loadHistory = () => {
    if (!adoptId) return;
    const params = new URLSearchParams({ adoptId });
    if (selectedId) params.set("taskTemplateId", selectedId);
    fetch(`${apiBase}/history?${params.toString()}`, { credentials: "include" })
      .then(response =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`HTTP ${response.status}`))
      )
      .then(data =>
        setHistoryRecords(Array.isArray(data?.records) ? data.records : [])
      )
      .catch(() => {});
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptId, apiBase, selectedId]);

  useEffect(() => {
    if (!adoptId || !isResearchPpt) return;
    fetch(
      `${apiBase}/research-ppt/templates?adoptId=${encodeURIComponent(adoptId)}`,
      { credentials: "include" }
    )
      .then(response =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`HTTP ${response.status}`))
      )
      .then(data => {
        const rows = Array.isArray(data?.templates) ? data.templates : [];
        setPptTemplates(rows);
        if (
          !rows.some((item: PptTemplateOption) => item.id === pptTemplateId) &&
          pptTemplateId !== "custom"
        ) {
          setPptTemplateId(rows[0]?.id || "huawei-light");
        }
      })
      .catch(() => {});
  }, [adoptId, apiBase, isResearchPpt, pptTemplateId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    const maxHeight = lineHeight * 10 + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, hasConversation]);

  useEffect(() => {
    setPptPreviewFrame(0);
    if (!hoveredPptTemplateId) return;
    const timer = window.setInterval(() => {
      setPptPreviewFrame(frame => (frame + 1) % 3);
    }, 850);
    return () => window.clearInterval(timer);
  }, [hoveredPptTemplateId]);

  const isNearBottom = () => {
    if (typeof window === "undefined") return true;
    const doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 180;
  };

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    programmaticScrollRef.current = true;
    conversationEndRef.current?.scrollIntoView({ block: "end", behavior });
    window.setTimeout(
      () => {
        programmaticScrollRef.current = false;
        lastScrollYRef.current = window.scrollY;
      },
      behavior === "smooth" ? 450 : 80
    );
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
      } else if (
        !programmaticScrollRef.current &&
        currentY < lastScrollYRef.current - 8
      ) {
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

  const selectTemplate = (
    template: TaskTemplate,
    options: { clearIfSame?: boolean } = {}
  ) => {
    if (running || routing) return;
    if (selectedId === template.id) {
      setCompactMoreOpen(false);
      if (options.clearIfSame) clearTemplateMode();
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
    setPreview(null);
    setResearchPreview(null);
    setWorkDirectoryPreview(null);
    setCompactMoreOpen(false);
  };

  const chooseTemplate = (template: TaskTemplate) => {
    selectTemplate(template, { clearIfSame: true });
  };

  const clearTemplateMode = () => {
    if (running || routing) return;
    setSelectedId("");
    setAutoScrollEnabled(true);
    setShowJumpToLatest(false);
    setCompactMoreOpen(false);
  };

  const uploadToWorkspace = async (
    file: File,
    kind: "inputs" | "templates" = "inputs"
  ): Promise<UploadedWorkbenchFile> => {
    if (!adoptId) throw new Error("adoptId_required");
    if (file.size <= 0) throw new Error("文件为空");
    const maxUploadBytes = uploadLimitForTask(selectedId, kind);
    if (file.size > maxUploadBytes)
      throw new Error(`文件超过 ${formatSize(maxUploadBytes)}，请先压缩或拆分`);
    const contentBase64 = await fileToBase64(file);
    const response = await fetch("/api/claw/files/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        adoptId,
        path: `office/task-workbench/${uploadTaskId}/${kind}`,
        filename: file.name,
        contentBase64,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data?.error || `上传失败 (${response.status})`);
    return {
      name: file.name,
      path: data.path,
      size: Number(data.size || file.size),
    };
  };

  const handleAttachmentPick = async (files: FileList | null) => {
    if (!files?.length || uploading || running || routing) return;
    setUploading(true);
    try {
      const uploaded: UploadedWorkbenchFile[] = [];
      for (const file of Array.from(files))
        uploaded.push(await uploadToWorkspace(file, "inputs"));
      setAttachments(current => [...current, ...uploaded].slice(0, 16));
      toast.success(`已上传 ${uploaded.length} 个材料`);
    } catch (reason: any) {
      toast.error(reason?.message || "附件上传失败");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (name: string) => {
    setAttachments(current => current.filter(item => item.name !== name));
  };

  const handlePptTemplatePick = async (file: File | null | undefined) => {
    if (!file || uploading || running || routing) return;
    if (!/\.(pptx|ppt)$/i.test(file.name)) {
      toast.error("请上传 .pptx 或 .ppt 模板");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadToWorkspace(file, "templates");
      setCustomPptTemplate(uploaded);
      setPptTemplateId("custom");
      toast.success("模板已上传");
    } catch (reason: any) {
      toast.error(reason?.message || "模板上传失败");
    } finally {
      setUploading(false);
    }
  };

  const buildInputOptions = () => {
    if (!isResearchPpt) {
      return attachments.length
        ? { contextPaths: attachments.map(item => item.path) }
        : undefined;
    }
    return {
      templateId: pptTemplateId,
      templateName:
        selectedPptTemplate?.name ||
        (pptTemplateId === "custom" ? customPptTemplate?.name : undefined),
      templatePath:
        pptTemplateId === "custom" ? customPptTemplate?.path : undefined,
      slideRange: pptSlideRange,
      contextPaths: attachments.map(item => item.path),
    };
  };

  const startNewTask = () => {
    if (running || routing || uploading) return;
    setUploadTaskId(makeWorkbenchTaskId());
    setPrompt("");
    setAttachments([]);
    setSubmittedPrompt("");
    setSubmittedAttachments([]);
    setRouterDecision(null);
    setRun(null);
    setLiveStages([]);
    setError(null);
    setPreview(null);
    setResearchPreview(null);
    setWorkDirectoryPreview(null);
  };

  const runTask = async () => {
    if (!selected || !prompt.trim() || running) return;
    if (isResearchPpt && pptTemplateId === "custom" && !customPptTemplate) {
      toast.error("请先上传自定义 PPT 模板");
      return;
    }
    const finalPrompt = prompt.trim();
    const inputOptions = buildInputOptions();
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
      const response = await fetch(`${apiBase}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adoptId,
          taskTemplateId: selected.id,
          prompt: finalPrompt,
          harnessPlan: routerDecision?.harnessPlan,
          inputOptions,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.detail || data?.error || `HTTP ${response.status}`
        );
      }
      setRun(data.taskRun);
      loadHistory();
      toast.success(
        `任务完成：${statusMeta(data.taskRun?.status || "").label}`
      );
    } catch (reason: any) {
      const message = reason?.message || "任务运行失败";
      setError(message);
      toast.error(message);
    } finally {
      setRunning(false);
      setUploadTaskId(makeWorkbenchTaskId());
    }
  };

  const runTaskStream = async () => {
    if (!prompt.trim() || running || routing) return;
    if (isResearchPpt && pptTemplateId === "custom" && !customPptTemplate) {
      toast.error("请先上传自定义 PPT 模板");
      return;
    }
    const finalPrompt = prompt.trim();
    const inputOptions = buildInputOptions();
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
    const recoverLatestRunFromHistory = async (
      taskTemplateId: string,
      startedAtMs: number
    ) => {
      if (!adoptId) return null;
      const params = new URLSearchParams({ adoptId, taskTemplateId });
      const historyResponse = await fetch(
        `${apiBase}/history?${params.toString()}`,
        { credentials: "include" }
      );
      const historyData = await historyResponse.json().catch(() => ({}));
      if (!historyResponse.ok) return null;
      const records = Array.isArray(historyData?.records)
        ? (historyData.records as TaskHistoryRecord[])
        : [];
      setHistoryRecords(records);
      const latest = records
        .filter(item => item.taskTemplateId === taskTemplateId)
        .sort(
          (a, b) =>
            Date.parse(b.updatedAt || b.createdAt || "") -
            Date.parse(a.updatedAt || a.createdAt || "")
        )
        .find(item => {
          const updatedAt = Date.parse(item.updatedAt || item.createdAt || "");
          return Number.isFinite(updatedAt)
            ? updatedAt >= startedAtMs - 60_000
            : true;
        });
      if (!latest) return null;
      const detailResponse = await fetch(
        `${apiBase}/history/${encodeURIComponent(latest.id)}?adoptId=${encodeURIComponent(adoptId)}`,
        { credentials: "include" }
      );
      const detailData = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok || !detailData?.taskRun) return null;
      return {
        record: latest,
        taskRun: detailData.taskRun as TaskRun,
      };
    };
    try {
      const streamStartedAtMs = Date.now();
      const routeResponse = await fetch(`${apiBase}/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adoptId,
          taskTemplateId: selected?.id,
          prompt: finalPrompt,
        }),
      });
      const routeData = await routeResponse.json().catch(() => ({}));
      if (!routeResponse.ok) {
        throw new Error(
          routeData?.detail ||
            routeData?.error ||
            `HTTP ${routeResponse.status}`
        );
      }
      const decision = routeData?.decision as RouterDecision | undefined;
      if (!decision?.intent) throw new Error("router_decision_missing");
      setRouterDecision(decision);
      setRouting(false);

      if (decision.intent !== "run_template") {
        if (decision.intent === "clarify")
          toast.info("需要再确认一下交付目标。");
        if (decision.intent === "unsupported")
          toast.warning("这个请求不会自动执行。");
        return;
      }

      const taskTemplateId = decision.selectedTemplateId || selected?.id;
      if (!taskTemplateId) throw new Error("router_did_not_select_template");
      const templateToRun = availableTemplates.find(
        item => item.id === taskTemplateId
      );
      if (!templateToRun)
        throw new Error(`template_not_loaded: ${taskTemplateId}`);
      if (taskTemplateId !== selectedId) setSelectedId(taskTemplateId);
      const streamPrompt = decision.normalizedGoal || finalPrompt;
      setRunning(true);
      setLiveStages(
        decision.harnessPlan?.stages?.length
          ? [
              ...(hasControlledDataStage(decision.harnessPlan)
                ? [controlledDataLiveStage()]
                : []),
              ...decision.harnessPlan.stages.map(stage => ({
                stageId: stage.stageId,
                personaId: stage.role.toLowerCase(),
                agentDefinitionId: stage.profile,
                displayName: `${harnessRoleLabel(stage.role)} · ${stage.profile}`,
                status: "waiting" as const,
                events: [],
                text: "",
              })),
            ]
          : templateToRun.stages.map(stage => ({
              stageId: stage.id,
              personaId: stage.personaId,
              agentDefinitionId: stage.agentDefinitionId,
              displayName: stage.displayName,
              status: "waiting" as const,
              events: [],
              text: "",
            }))
      );

      const response = await fetch(`${apiBase}/run-stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          adoptId,
          taskTemplateId,
          prompt: streamPrompt,
          harnessPlan: decision.harnessPlan,
          inputOptions,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data?.detail || data?.error || `HTTP ${response.status}`
        );
      }
      if (!response.body) throw new Error("stream_not_available");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedRun: TaskRun | null = null;

      const applyPayload = (payload: StreamPayload) => {
        if (payload.type === "data_pack_built" && payload.dataPack) {
          const dataPack = payload.dataPack;
          const evidenceCount = Number(dataPack.evidenceCount || 0);
          const gapCount = Number(dataPack.gapCount || 0);
          const level =
            dataPack.confidenceSummary?.level ||
            (evidenceCount ? "medium" : "low");
          const message = `受控数据包已准备：${evidenceCount} 条证据，${gapCount} 个缺口，${confidenceLabel(level)}`;
          setLiveStages(current =>
            current.map(stage =>
              CONTROLLED_DATA_STAGE_IDS.has(stage.stageId)
                ? {
                    ...stage,
                    status: "running",
                    events: appendLimited(stage.events, message),
                  }
                : stage
            )
          );
          return;
        }
        if (payload.type === "compute_pack_built" && payload.computePack) {
          const computePack = payload.computePack;
          const computeCount = Number(computePack.computeCount || 0);
          const gapCount = Number(computePack.gapCount || 0);
          const message = `受控计算包已准备：${computeCount} 项计算，${gapCount} 个缺口`;
          setLiveStages(current =>
            current.map(stage =>
              CONTROLLED_COMPUTE_STAGE_IDS.has(stage.stageId) ||
              CONTROLLED_DATA_STAGE_IDS.has(stage.stageId)
                ? {
                    ...stage,
                    status: "running",
                    events: appendLimited(stage.events, message),
                  }
                : stage
            )
          );
          return;
        }
        if (payload.type === "harness_executor_started") {
          setLiveStages(current =>
            current.map(stage =>
              CONTROLLED_DATA_STAGE_IDS.has(stage.stageId)
                ? {
                    ...stage,
                    status: "success",
                    events: appendLimited(stage.events, "数据包已交给 Harness 执行"),
                  }
                : stage
            )
          );
          return;
        }
        if (payload.type === "stage_started" && payload.event) {
          const event = payload.event;
          setLiveStages(current =>
            current.map(stage => {
              if (
                CONTROLLED_DATA_STAGE_IDS.has(stage.stageId) &&
                stage.status !== "success"
              ) {
                return {
                  ...stage,
                  status: "success",
                  events: appendLimited(stage.events, "数据准备完成"),
                };
              }
              if (stage.stageId !== event.stageId) return stage;
              return {
                ...stage,
                status: "running",
                startedAt: Date.now(),
                events: appendLimited(
                  stage.events,
                  `${event.displayName || stage.displayName} 已开始`
                ),
              };
            })
          );
          return;
        }
        if (payload.type === "stage_retry" && payload.event) {
          const event = payload.event;
          setLiveStages(current =>
            current.map(stage =>
              stage.stageId === event.stageId
                ? {
                    ...stage,
                    status: "running",
                    events: appendLimited(
                      stage.events,
                      `重试：${event.reason || "上次执行未成功"}`
                    ),
                  }
                : stage
            )
          );
          return;
        }
        if (payload.type === "agent_event" && payload.event) {
          const event = payload.event;
          setLiveStages(current =>
            current.map(stage =>
              stage.agentDefinitionId === event.agentDefinitionId
                ? (() => {
                    const progressMessage =
                      event.type === "progress" ||
                      event.type === "artifact_hint"
                        ? normalizeProgressMessage(
                            event.message ||
                              (event.type === "artifact_hint"
                                ? "整理交付文件"
                                : "正在生成内容")
                          )
                        : "";
                    return {
                      ...stage,
                      status:
                        stage.status === "waiting" ? "running" : stage.status,
                      events: progressMessage
                        ? appendLimited(stage.events, progressMessage)
                        : stage.events,
                      text:
                        event.type === "text_delta"
                          ? `${stage.text}${event.text || ""}`
                          : stage.text,
                      error:
                        event.type === "error" ? event.message : stage.error,
                    };
                  })()
                : stage
            )
          );
          return;
        }
        if (payload.type === "stage_done" && payload.event?.stage) {
          const done = payload.event.stage as TaskStageResult;
          setLiveStages(current =>
            current.map(stage =>
              stage.stageId === done.stageId
                ? {
                    ...stage,
                    status:
                      done.status === "success"
                        ? "success"
                        : done.status === "timeout"
                          ? "timeout"
                          : "failed",
                    durationMs: done.durationMs,
                    artifacts: done.artifacts,
                    runResult: done.runResult,
                    error: done.runResult?.error?.detail,
                    text:
                      stage.text ||
                      done.runResult?.output ||
                      done.runResult?.summary ||
                      "",
                    events: appendLimited(
                      stage.events,
                      done.status === "success"
                        ? "阶段完成"
                        : `阶段未完成：${done.runResult?.error?.detail || done.status}`
                    ),
                  }
                : stage
            )
          );
          return;
        }
        if (payload.type === "run_done" && payload.taskRun) {
          completedRun = payload.taskRun;
          setRun(payload.taskRun);
          setLiveStages(current =>
            current.map(stage => {
              if (stage.stageId === CONTROLLED_DATA_STAGE_ID) {
                return {
                  ...stage,
                  status:
                    stage.status === "failed" || stage.status === "timeout"
                      ? stage.status
                      : "success",
                  events: appendLimited(stage.events, "数据准备完成"),
                };
              }
              const finalStage = payload.taskRun?.stages?.find(
                item => item.stageId === stage.stageId
              );
              if (!finalStage) return stage;
              return {
                ...stage,
                status:
                  finalStage.status === "success"
                    ? "success"
                    : finalStage.status === "timeout"
                      ? "timeout"
                      : "failed",
                durationMs: finalStage.durationMs,
                artifacts: finalStage.artifacts,
                runResult: finalStage.runResult,
                error: finalStage.runResult?.error?.detail,
                text:
                  finalStage.runResult?.output ||
                  finalStage.runResult?.summary ||
                  stage.text,
              };
            })
          );
          return;
        }
        if (payload.type === "run_failed") {
          throw new Error(
            payload.error?.detail || payload.error?.kind || "任务运行失败"
          );
        }
      };

      const consumeBlock = (block: string) => {
        const dataLines = block
          .split(/\r?\n/)
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trim());
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
      let finalRun = completedRun as TaskRun | null;
      if (!finalRun) {
        const recovered = await recoverLatestRunFromHistory(
          taskTemplateId,
          streamStartedAtMs
        );
        if (recovered) {
          finalRun = recovered.taskRun;
          setRun(recovered.taskRun);
          setLiveStages([]);
          setRouterDecision(null);
          setSubmittedPrompt(
            recovered.record.prompt ||
              String(recovered.taskRun.metadata?.rawUserPrompt || finalPrompt)
          );
          toast.info("已从任务历史恢复刚完成的结果。");
        }
      }
      if (!finalRun) throw new Error("stream_finished_without_result");
      loadHistory();
      toast.success(`任务完成，${statusMeta(finalRun.status).label}`);
    } catch (reason: any) {
      const message = reason?.message || "任务运行失败";
      setError(message);
      toast.error(message);
    } finally {
      setRouting(false);
      setRunning(false);
      setUploadTaskId(makeWorkbenchTaskId());
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

  useEffect(() => {
    if (!compactOfficeMode || !run || preview) return;
    const artifacts = preferredDisplayArtifacts(run.artifacts || []);
    const htmlArtifact = artifacts.find(
      artifact =>
        shouldAutoOpenArtifactPreview(run, artifact) &&
        (artifact.type === "html" || /\.html?$/i.test(artifact.name))
    );
    if (htmlArtifact) openPreview(htmlArtifact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactOfficeMode, run?.taskRunId]);

  const openResearchPreview = (
    title: string,
    metadata: Record<string, unknown>
  ) => {
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

  const restoreHistoryRecord = async (record: TaskHistoryRecord) => {
    if (!adoptId || running || routing) return;
    try {
      const response = await fetch(
        `${apiBase}/history/${encodeURIComponent(record.id)}?adoptId=${encodeURIComponent(adoptId)}`,
        { credentials: "include" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data?.detail || data?.error || `HTTP ${response.status}`
        );
      const taskRun = data.taskRun as TaskRun;
      setSelectedId(taskRun.taskTemplateId || record.taskTemplateId);
      setSubmittedPrompt(
        record.prompt || String(taskRun.metadata?.rawUserPrompt || "")
      );
      setSubmittedAttachments([]);
      setRouterDecision(null);
      setLiveStages([]);
      setRun(taskRun);
      setError(null);
      setHistoryOpen(false);
      setPreview(null);
      setResearchPreview(null);
      setWorkDirectoryPreview(null);
      const inputOptions = (taskRun.metadata?.inputOptions ||
        record.metadata?.inputOptions ||
        {}) as Record<string, any>;
      if (
        (taskRun.taskTemplateId || record.taskTemplateId) === "research_ppt"
      ) {
        setPptTemplateId(String(inputOptions.templateId || "huawei-light"));
        setCustomPptTemplate(
          inputOptions.templateId === "custom" && inputOptions.templatePath
            ? {
                name: String(inputOptions.templateName || "自定义模板"),
                path: String(inputOptions.templatePath),
                size: 0,
              }
            : null
        );
        setAttachments(
          Array.isArray(inputOptions.contextPaths)
            ? inputOptions.contextPaths.map((item: string) => ({
                name: String(item).split("/").pop() || String(item),
                path: String(item),
                size: 0,
              }))
            : []
        );
      }
      setAutoScrollEnabled(true);
      window.setTimeout(() => scrollToLatest("auto"), 50);
    } catch (reason: any) {
      toast.error(reason?.message || "历史任务加载失败");
    }
  };

  const deleteHistoryRecord = async (record: TaskHistoryRecord) => {
    if (!adoptId || running || routing) return;
    try {
      const response = await fetch(
        `${apiBase}/history/${encodeURIComponent(record.id)}?adoptId=${encodeURIComponent(adoptId)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data?.detail || data?.error || `HTTP ${response.status}`
        );
      setHistoryRecords(current =>
        current.filter(item => item.id !== record.id)
      );
      toast.success("已删除历史记录");
    } catch (reason: any) {
      toast.error(reason?.message || "删除历史失败");
    }
  };

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        disabled={running || routing}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs"
        style={{
          border: "1px solid var(--oc-border)",
          background: "var(--oc-panel)",
          color: "var(--oc-text-secondary)",
        }}
        title="历史任务"
      >
        <History size={14} />
        历史
      </button>
      <button
        type="button"
        onClick={startNewTask}
        disabled={running || routing || uploading}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs"
        style={{
          border: "1px solid var(--oc-border)",
          background: "var(--oc-panel)",
          color: "var(--oc-text-secondary)",
        }}
        title="新建任务"
      >
        <RefreshCw size={14} />
        新建
      </button>
    </>
  );

  const pptTemplatePicker = isResearchPpt ? (
    <section className="mx-auto w-full max-w-[760px]">
      <div className="relative mb-2 flex items-center justify-between gap-3">
        <div
          className="text-sm font-semibold"
          style={{ color: "var(--oc-text-primary)" }}
        >
          选择模板
        </div>
        <div className="group relative">
          <span
            className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            style={{
              background: "var(--oc-bg-elevated)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-secondary)",
            }}
          >
            生成的页面数量
          </span>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs"
            onClick={() => setPptSlideRangeOpen(open => !open)}
            style={{
              border: "1px solid var(--oc-border)",
              background: "var(--oc-panel)",
              color: "var(--oc-text-secondary)",
            }}
          >
            <Presentation size={14} />
            {pptSlideRange} 张
            <ChevronDown size={14} />
          </button>
          {pptSlideRangeOpen ? (
            <div
              className="absolute right-0 z-20 mt-2 w-28 overflow-hidden rounded-xl border p-1 text-xs shadow-lg"
              style={{
                borderColor: "var(--oc-border)",
                background: "var(--oc-bg-elevated)",
                color: "var(--oc-text-secondary)",
              }}
            >
              {pptSlideRangeOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition"
                  onClick={() => {
                    setPptSlideRange(option);
                    setPptSlideRangeOpen(false);
                  }}
                  style={{
                    background:
                      option === pptSlideRange
                        ? "color-mix(in oklab, var(--oc-info) 10%, transparent)"
                        : "transparent",
                    color:
                      option === pptSlideRange
                        ? "var(--oc-info)"
                        : "var(--oc-text-secondary)",
                  }}
                >
                  <span>{option}</span>
                  <span style={{ color: "var(--oc-text-tertiary)" }}>张</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <button
          type="button"
          disabled={running || routing || uploading}
          onClick={() => pptTemplateInputRef.current?.click()}
          className="w-[180px] shrink-0 text-center transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: "var(--oc-text-primary)" }}
          title={customPptTemplate ? customPptTemplate.name : "导入模板"}
        >
          <div
            className="flex h-[106px] w-[180px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg"
            style={{
              background: "transparent",
              border:
                "1px dashed color-mix(in oklab, var(--oc-border) 88%, var(--oc-text-tertiary))",
              color: "var(--oc-text-tertiary)",
            }}
          >
            <Presentation size={20} />
            <span className="text-[13px]">导入模板</span>
          </div>
        </button>
        {pptTemplates.map(template => (
          <button
            key={template.id}
            type="button"
            disabled={
              running || routing || uploading || template.available === false
            }
            onClick={() => {
              setPptTemplateId(template.id);
              setCustomPptTemplate(null);
            }}
            onMouseEnter={() => setHoveredPptTemplateId(template.id)}
            onMouseLeave={() => setHoveredPptTemplateId(null)}
            className="group w-[180px] shrink-0 text-center transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ color: "var(--oc-text-primary)" }}
            title={`${template.name}${template.description ? ` · ${template.description}` : ""}`}
          >
            <div
              className="relative h-[106px] w-[180px] overflow-hidden rounded-lg"
              style={{
                border:
                  pptTemplateId === template.id
                    ? "2px solid var(--oc-info)"
                    : "1.5px solid transparent",
              }}
            >
              {template.thumbnailUrl ? (
                <>
                  {(template.previewUrls?.length
                    ? template.previewUrls
                    : [
                        template.thumbnailUrl,
                        template.thumbnailUrl,
                        template.thumbnailUrl,
                      ]
                  )
                    .slice(0, 3)
                    .map((url, index) => (
                      <img
                        key={`${template.id}-${index}`}
                        src={url}
                        alt={template.name}
                        className="absolute inset-0 h-full w-full rounded-[6px] object-cover transition-all duration-500"
                        style={{
                          opacity:
                            hoveredPptTemplateId === template.id
                              ? pptPreviewFrame === index
                                ? 1
                                : 0
                              : index === 0
                                ? 1
                                : 0,
                          transform:
                            hoveredPptTemplateId === template.id &&
                            pptPreviewFrame === index
                              ? "scale(1.025)"
                              : "scale(1)",
                        }}
                      />
                    ))}
                  <div
                    className="absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      background:
                        "color-mix(in oklab, var(--oc-bg-elevated) 86%, transparent)",
                      color: "var(--oc-text-secondary)",
                      border: "1px solid var(--oc-border-subtle)",
                    }}
                  >
                    {hoveredPptTemplateId === template.id
                      ? `${pptPreviewFrame + 1}/3`
                      : "预览"}
                  </div>
                </>
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center rounded-[6px]"
                  style={{
                    background: "var(--oc-panel)",
                    border: "1px solid var(--oc-border)",
                    color: "var(--oc-text-tertiary)",
                  }}
                >
                  <ImageIcon size={20} />
                </div>
              )}
              <span
                className="absolute bottom-2 right-2 max-w-[120px] truncate rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  background:
                    "color-mix(in oklab, var(--oc-bg-elevated) 84%, transparent)",
                  color: "var(--oc-text-secondary)",
                  border: "1px solid var(--oc-border-subtle)",
                }}
              >
                {template.name}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const composer = (
    <DocumentComposer
      value={prompt}
      onChange={setPrompt}
      onSubmit={() => void runTaskStream()}
      disabled={running || routing || uploading}
      busy={running || routing || uploading}
      placeholder={
        compactOfficeMode
          ? hasConversation
            ? ""
            : selected
              ? taskPlaceholder(selected)
              : "分配一个任务或提问任何问题"
          : taskPlaceholder(selected)
      }
      rows={hasConversation ? 1 : 2}
      textareaRef={textareaRef}
      attachments={attachments.map(item => ({ name: item.name }))}
      onAttachFiles={files => void handleAttachmentPick(files)}
      attachmentAccept={attachmentAcceptForTask(selectedId)}
      onRemoveAttachment={removeAttachment}
      selectedLabel={selected ? taskDisplayName(selected) : undefined}
      showSelectedPill={
        compactOfficeMode && Boolean(selected) && !hasConversation
      }
      showSelectedHeader={!compactOfficeMode && Boolean(selected)}
      onClearSelection={clearTemplateMode}
      compact={compactOfficeMode}
      activeTone={compactOfficeMode ? "dark" : "accent"}
    />
  );

  const sidePanelOpen = Boolean(
    preview || researchPreview || workDirectoryPreview
  );
  const fixedLeft = showSelector
    ? "18rem"
    : "var(--lingxia-sidebar-width, 0px)";
  const fixedLeftClass = showSelector
    ? "lg:left-72"
    : "lg:left-[var(--document-fixed-left)]";
  const compactFixedLeftClass = fixedLeftClass;
  const dockBottomInset = compactOfficeMode ? 24 : 20;
  const bottomDockSpace = `${Math.max(dockHeight + dockBottomInset, compactOfficeMode ? 128 : 112)}px`;
  const dockInsetStyle = {
    transition: "right 0.25s ease, max-width 0.25s ease",
  };
  const selectorSlot = (
    <>
      <input
        ref={pptTemplateInputRef}
        type="file"
        accept=".pptx,.ppt"
        className="hidden"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void handlePptTemplatePick(file);
        }}
      />
      {showSelector ? (
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
      ) : null}
    </>
  );
  const sidePanel = preview ? (
    <PreviewSidePanel
      preview={preview}
      onClose={() => setPreview(null)}
      onFullscreen={() => setFullscreenPreview(preview)}
    />
  ) : researchPreview ? (
    <ResearchSourceSidePanel
      preview={researchPreview}
      onClose={() => setResearchPreview(null)}
    />
  ) : workDirectoryPreview ? (
    <WorkDirectorySidePanel
      run={run}
      preview={workDirectoryPreview}
      onClose={() => setWorkDirectoryPreview(null)}
      onPreview={openPreview}
    />
  ) : null;

  return (
    <div
      className={
        compactOfficeMode ? "h-full min-h-0 overflow-y-auto" : "min-h-screen"
      }
      style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}
    >
      <DocumentWorkbenchLayout
        compact={compactOfficeMode}
        selector={selectorSlot}
        sidePanel={sidePanel}
        fixedLeft={fixedLeft}
        bottomDockSpace={bottomDockSpace}
        previewBottomInset={`${dockBottomInset}px`}
      >
        <button
          type="button"
          onClick={openWorkDirectory}
          className={`${compactOfficeMode ? "hidden" : "flex"} fixed right-5 top-5 z-30 h-11 w-11 items-center justify-center rounded-full border bg-white/90 shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5`}
          style={{
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-primary)",
          }}
          title="打开工作目录"
        >
          <FolderOpen size={19} />
          {run?.artifacts?.length || workFolderAgentIds.length ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full"
              style={{ background: "var(--oc-accent)" }}
            />
          ) : null}
        </button>

        {!hasConversation ? (
          <div
            className={
              compactOfficeMode
                ? "mx-auto flex min-h-screen w-full flex-col px-4 py-4"
                : "flex min-h-screen flex-col items-center justify-center px-6 py-10"
            }
          >
            {compactOfficeMode ? (
              <div className="mb-8">
                <DocumentTaskHeader
                  icon={
                    <SelectedTaskIcon
                      size={18}
                      style={{ color: "var(--oc-text-secondary)" }}
                    />
                  }
                  title={taskDisplayName(selected)}
                  subtitle="办公空间"
                  onBack={onBack}
                  actions={headerActions}
                />
              </div>
            ) : null}
            <div
              className={
                compactOfficeMode
                  ? "flex flex-1 flex-col items-center pb-12 pt-9"
                  : ""
              }
            >
              {compactOfficeMode ? (
                <div className="mx-auto flex w-full max-w-[760px] flex-col items-center">
                  <h1
                    className="m-0 text-center text-[42px] font-medium leading-[1.3]"
                    style={{
                      color: "var(--oc-text-primary)",
                      fontFamily: "'Noto Serif SC', 'Songti SC', SimSun, serif",
                    }}
                  >
                    我能为你做什么？
                  </h1>
                  <div className="mt-14 w-full">{composer}</div>
                  <CompactTaskSwitcher
                    templates={availableTemplates}
                    selectedId={selectedId}
                    disabled={running || routing || uploading}
                    moreOpen={compactMoreOpen}
                    onChoose={template => selectTemplate(template)}
                    onToggleMore={() => setCompactMoreOpen(open => !open)}
                  />
                </div>
              ) : (
                <>
                  <div className="mb-8 text-center">
                    <div
                      className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-3xl text-white shadow-lg"
                      style={{ background: "var(--oc-accent)" }}
                    >
                      <Bot size={24} />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      准备好了，随时开始
                    </h1>
                  </div>
                  <div className="w-full max-w-3xl">{composer}</div>
                </>
              )}
              {compactOfficeMode ? (
                <div className="mt-7 w-full">
                  <DocumentPromptCards
                    prompts={quickPrompts}
                    disabled={running || routing}
                    onChoose={setPrompt}
                  />
                </div>
              ) : null}
              {compactOfficeMode && pptTemplatePicker ? (
                <div className="mt-10 w-full">{pptTemplatePicker}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div
              className={`${compactOfficeMode ? "max-w-[760px] break-words pb-12 [overflow-wrap:anywhere] xl:data-[preview=true]:max-w-[640px]" : "max-w-5xl pb-32"} mx-auto flex w-full flex-1 flex-col px-5 pt-4`}
              data-preview={sidePanelOpen}
            >
              {compactOfficeMode ? (
                <div className="mb-5">
                  <DocumentTaskHeader
                    icon={
                      <SelectedTaskIcon
                        size={18}
                        style={{ color: "var(--oc-text-secondary)" }}
                      />
                    }
                    title={taskDisplayName(selected)}
                    subtitle="办公空间"
                    onBack={onBack}
                    actions={headerActions}
                  />
                </div>
              ) : null}
              <div
                className={`${compactOfficeMode ? "mb-4" : "mb-6"} flex flex-wrap items-center justify-between gap-3`}
              >
                <div>
                  {!compactOfficeMode ? (
                    <>
                      <div
                        className="text-xs font-medium uppercase tracking-[0.22em]"
                        style={{ color: "var(--oc-text-tertiary)" }}
                      >
                        {titleLabel}
                      </div>
                      <h1 className="mt-1 text-xl font-semibold">
                        {taskDisplayName(selected)}
                      </h1>
                    </>
                  ) : null}
                  {!compactOfficeMode && submittedPrompt ? (
                    <div
                      className="mt-1 max-w-3xl truncate text-sm"
                      style={{ color: "var(--oc-text-tertiary)" }}
                    >
                      任务目标：{submittedPrompt}
                    </div>
                  ) : null}
                </div>
                <div
                  className={
                    compactOfficeMode ? "hidden" : "flex flex-wrap gap-2"
                  }
                >
                  {selected?.outputPolicy.disclaimers.map(item => (
                    <span
                      key={item}
                      className="rounded-full px-3 py-1 text-xs"
                      style={{
                        background: "var(--oc-muted)",
                        color: "var(--oc-text-secondary)",
                      }}
                    >
                      {DISCLAIMER_LABELS[item] || item}
                    </span>
                  ))}
                </div>
              </div>

              {compactOfficeMode ? (
                <CompactUserPrompt prompt={submittedPrompt} />
              ) : submittedPrompt ? (
                <UserTaskCard
                  prompt={submittedPrompt}
                  attachments={submittedAttachments}
                />
              ) : null}
              {!compactOfficeMode ? (
                <RouterDecisionCard
                  routing={routing}
                  decision={routerDecision}
                />
              ) : null}
              {!compactOfficeMode && (running || liveStages.length || run) ? (
                <ExecutionPlanBar
                  selected={selected}
                  decision={routerDecision}
                  liveStages={liveStages}
                  run={run}
                />
              ) : null}

              {routing ||
              routerDecision ||
              running ||
              liveStages.length ||
              run ? (
                <DocumentTimeline compact={compactOfficeMode}>
                  <div
                    className={
                      compactOfficeMode
                        ? "sr-only"
                        : "mb-3 flex items-center gap-2 text-sm font-semibold"
                    }
                    style={
                      compactOfficeMode
                        ? undefined
                        : { color: "var(--oc-text-secondary)" }
                    }
                  >
                    <Sparkles size={16} style={{ color: "var(--oc-accent)" }} />
                    任务执行过程
                  </div>

                  {compactOfficeMode ? (
                    <CompactRouterStage
                      routing={routing}
                      decision={routerDecision}
                      selected={selected}
                    />
                  ) : null}
                  {liveStages.length
                    ? (compactOfficeMode
                        ? liveStages.filter(
                            stage =>
                              stage.status !== "waiting" ||
                              stage.events.length ||
                              stage.text ||
                              stage.runResult
                          )
                        : liveStages
                      ).map(stage => (
                        <LiveStageCard
                          key={stage.stageId}
                          stage={stage}
                          onPreview={openPreview}
                          onOpenResearch={openResearchPreview}
                          compact={compactOfficeMode}
                        />
                      ))
                    : run?.stages.map(stage => (
                        <AgentMessageCard
                          key={stage.stageId}
                          stage={stage}
                          artifacts={stage.artifacts || []}
                          onPreview={openPreview}
                          onOpenResearch={openResearchPreview}
                          compact={compactOfficeMode}
                        />
                      ))}
                </DocumentTimeline>
              ) : null}

              {error ? (
                <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                  <div className="mb-1 font-semibold">任务失败</div>
                  {error}
                </div>
              ) : null}

              {!compactOfficeMode && run?.disclaimers?.length ? (
                <div
                  className="mt-5 rounded-2xl px-4 py-3 text-xs leading-6"
                  style={{
                    background: "var(--oc-bg-soft)",
                    color: "var(--oc-text-secondary)",
                  }}
                >
                  {run.disclaimers
                    .map(item => DISCLAIMER_LABELS[item] || item)
                    .join(" · ")}
                </div>
              ) : null}

              <div
                ref={conversationEndRef}
                className={
                  compactOfficeMode
                    ? "h-[calc(var(--document-bottom-dock-space)+0.75rem)] shrink-0"
                    : ""
                }
              />
            </div>

            {showJumpToLatest ? (
              <div
                className={`pointer-events-none fixed bottom-[calc(var(--document-bottom-dock-space)+0.5rem)] left-0 right-0 z-30 px-4 xl:data-[preview=true]:right-[var(--document-side-panel-width)] ${compactOfficeMode ? compactFixedLeftClass : fixedLeftClass}`}
                data-preview={sidePanelOpen}
                style={dockInsetStyle}
              >
                <div className="mx-auto flex max-w-3xl justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setAutoScrollEnabled(true);
                      setShowJumpToLatest(false);
                      scrollToLatest("smooth");
                    }}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg"
                    style={{
                      borderColor: "var(--oc-border)",
                      background: "var(--oc-card)",
                      color: "var(--oc-text-primary)",
                    }}
                  >
                    <ArrowDown size={14} />
                    回到最新
                  </button>
                </div>
              </div>
            ) : null}

            <DocumentBottomDock
              leftClass={
                compactOfficeMode ? compactFixedLeftClass : fixedLeftClass
              }
              insetStyle={dockInsetStyle}
              previewOpen={sidePanelOpen}
              onDockSizeChange={setDockHeight}
              showGradient={compactOfficeMode}
              dockClassName={
                compactOfficeMode
                  ? "bottom-6 flex justify-center px-4 xl:data-[preview=true]:right-[var(--document-side-panel-width)]"
                  : "bottom-5 px-4 xl:data-[preview=true]:right-[var(--document-side-panel-width)]"
              }
              contentClassName={
                compactOfficeMode
                  ? "w-full max-w-[720px] data-[preview=true]:max-w-[600px]"
                  : "mx-auto max-w-5xl"
              }
            >
              {composer}
            </DocumentBottomDock>
          </>
        )}
      </DocumentWorkbenchLayout>

      <DocumentHistoryDrawer
        open={historyOpen}
        title={`${selected ? taskDisplayName(selected) : "办公任务"}历史`}
        subtitle="选择一个历史任务恢复过程和产物"
        query={historyQuery}
        onQueryChange={setHistoryQuery}
        onClose={() => setHistoryOpen(false)}
      >
        {filteredHistoryRecords.map(record => (
          <div
            key={record.id}
            className="group flex items-center gap-2 rounded-md p-2"
            style={{
              background:
                run?.taskRunId === record.id
                  ? "color-mix(in oklab, var(--oc-accent) 10%, var(--oc-panel))"
                  : "var(--oc-panel)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-primary)",
            }}
          >
            <button
              type="button"
              onClick={() => void restoreHistoryRecord(record)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-sm font-medium">{record.title}</div>
              <div
                className="mt-1 truncate text-xs"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {new Date(
                  record.updatedAt || record.createdAt
                ).toLocaleString()}{" "}
                · {record.status === "completed" ? "已完成" : record.status} ·{" "}
                {record.artifactCount || record.artifacts?.length || 0} 个产物
              </div>
            </button>
            <button
              type="button"
              disabled={running || routing}
              onClick={event => {
                event.stopPropagation();
                void deleteHistoryRecord(record);
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: "var(--oc-text-tertiary)" }}
              title="删除历史"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!filteredHistoryRecords.length ? (
          <div
            className="rounded-md p-4 text-sm"
            style={{
              background: "var(--oc-panel)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-tertiary)",
            }}
          >
            暂无历史任务
          </div>
        ) : null}
      </DocumentHistoryDrawer>

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

export default DocumentTaskWorkbench;
