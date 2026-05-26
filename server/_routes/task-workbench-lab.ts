import express from "express";
import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  AgentArtifact,
  AgentProvider,
  AgentRegistryError,
  AgentRunResult,
} from "../../shared/types/agent";
import type {
  TaskRunResult,
  TaskTemplate,
  TaskTemplateRunner,
} from "../../shared/types/task-template";
import {
  JsonTaskTemplateRunner,
  type TaskTemplateRunnerEvent,
} from "../_core/agent/task-template-runner";
import { JsonAgentRegistry } from "../_core/agent/agent-registry";
import { AdapterAgentClusterRunner } from "../_core/agent/agent-cluster-runner";
import { ClaudeCodeProvider } from "../_core/agent/providers/claude-code-provider";
import { HermesProvider } from "../_core/agent/providers/hermes-provider";
import { LegacyBusinessAgentResolver } from "../_core/agent/providers/legacy-business-agent-resolver";
import { StockAnalysisProvider } from "../_core/agent/providers/stock-analysis-provider";
import { redactSecrets } from "../_core/agent/providers/http-utils";
import type { ProviderStreamEvent } from "../_core/agent/providers/types";
import {
  routeTaskWorkbenchPrompt,
  taskWorkbenchHarnessPlanSchema,
  type TaskWorkbenchRouterDecision,
} from "../_core/agent/task-workbench-router";
import { createContext } from "../_core/context";
import {
  APP_ROOT,
  buildRuntimeSessionKey,
  requireClawOwner,
  resolveRuntimeAgentId,
  resolveRuntimeWorkspace,
  sanitizeRelPath,
} from "../_core/helpers";
import {
  buildChatRequestBody,
  type PermissionProfile,
} from "../_core/tool_schema";
import {
  buildQualityReport,
  generateImagePptxFromBlueprint,
  generatePptxFromBlueprint,
  getBuiltinPptTemplates,
  renderDeckHtml,
  resolveBlueprint,
} from "../_core/office-ppt";
import { markdownToDocxBuffer } from "../_core/office-docx";
import {
  summarizeMeetingWithOpenClaw,
  transcribeWithXfyunOst,
} from "../_core/voice";

type LabUser = {
  id: number;
  role: string;
  adoptId?: string;
  workspace?: string;
  claw?: any;
};
let lastKillSwitchLogMs = 0;
const REMOTE_HARNESS_EXECUTE_TIMEOUT_MS = Number(
  process.env.TASK_WORKBENCH_HARNESS_EXECUTE_TIMEOUT_MS || 15 * 60 * 1000
);

type GeneratedArtifact = {
  fileName: string;
  mimeType: string;
  body: Buffer | string;
  previewBody?: string;
  previewMimeType?: string;
  createdAt: number;
};
const generatedArtifacts = new Map<string, GeneratedArtifact>();
const execFileAsync = promisify(execFile);
const requireForTaskWorkbench = createRequire(import.meta.url);
const AdmZip = requireForTaskWorkbench("adm-zip") as any;

const runBodySchema = z.object({
  taskTemplateId: z.string().min(1),
  prompt: z.string().min(1),
  adoptId: z.string().optional(),
  harnessPlan: taskWorkbenchHarnessPlanSchema.optional(),
  inputOptions: z.record(z.string(), z.unknown()).optional(),
});

const remoteHarnessStageSchema = z.object({
  stageId: z.string().min(1),
  profile: z.string().min(1),
  role: z.string().optional(),
  status: z.enum(["success", "failed"]),
  runId: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  skillRefs: z.array(z.string()).optional(),
  schemaRef: z.string().nullable().optional(),
  schemaPayload: z.record(z.string(), z.unknown()).nullable().optional(),
  schemaErrors: z.array(z.string()).optional(),
  searchProviders: z.array(z.string()).optional(),
  searchProvidersAttempted: z.array(z.string()).optional(),
  searchResultCount: z.number().int().nonnegative().optional(),
  searchErrors: z.array(z.string()).optional(),
  sourceResearch: z.record(z.string(), z.unknown()).nullable().optional(),
  dataPack: z.record(z.string(), z.unknown()).nullable().optional(),
  computePack: z.record(z.string(), z.unknown()).nullable().optional(),
  artifactType: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.string().optional(),
        name: z.string().min(1),
        mimeType: z.string().optional(),
        contentBase64: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
  permissionPolicy: z.record(z.string(), z.unknown()).optional(),
  manifestWorker: z.record(z.string(), z.unknown()).nullable().optional(),
});

const remoteHarnessExecuteResponseSchema = z.object({
  status: z.enum(["completed", "failed"]),
  harnessPlan: z.unknown().optional(),
  stages: z.array(remoteHarnessStageSchema),
  finalOutput: z.string().optional(),
  artifactType: z.string().optional(),
});

const routeBodySchema = z.object({
  taskTemplateId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  adoptId: z.string().optional(),
});

function isTaskWorkbenchLabEnabled() {
  const legacyKillFile =
    process.env.AGENT_CLUSTER_LAB_KILL_FILE ||
    "/tmp/lingxia-agent-cluster-lab.disabled";
  const killFile =
    process.env.TASK_WORKBENCH_LAB_KILL_FILE ||
    (existsSync(legacyKillFile)
      ? legacyKillFile
      : "/tmp/lingxia-task-workbench-lab.disabled");
  if (existsSync(killFile)) {
    const now = Date.now();
    if (now - lastKillSwitchLogMs > 60_000) {
      console.warn(`[TASK-WORKBENCH-LAB] disabled by kill file: ${killFile}`);
      lastKillSwitchLogMs = now;
    }
    return false;
  }
  const explicit = process.env.TASK_WORKBENCH_LAB_ENABLED;
  if (explicit !== undefined) return String(explicit).toLowerCase() === "true";
  return (
    String(process.env.AGENT_CLUSTER_LAB_ENABLED || "false").toLowerCase() ===
    "true"
  );
}

function parseAllowUserIds() {
  return new Set(
    String(
      process.env.TASK_WORKBENCH_LAB_ALLOW_USER_IDS ||
        process.env.AGENT_CLUSTER_LAB_ALLOW_USER_IDS ||
        ""
    )
      .split(",")
      .map(item => Number(item.trim()))
      .filter(item => Number.isFinite(item) && item > 0)
  );
}

async function defaultAuthenticateUser(
  req: express.Request,
  res: express.Response
): Promise<LabUser | null> {
  const ctx = await createContext({ req, res } as any);
  const user = ctx.user;
  return user
    ? { id: Number(user.id), role: String(user.role || "user") }
    : null;
}

type RunnerCallbacks = {
  onTaskEvent?: (event: TaskTemplateRunnerEvent) => void;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
};

function createDefaultRunner(
  user: LabUser,
  callbacks: RunnerCallbacks = {}
): TaskTemplateRunner {
  const registry = new JsonAgentRegistry({
    resolveViewerContext: async (viewerUserId: number) => {
      const { getCoopProfile } = await import("../db/coop-identity");
      const profile = await getCoopProfile(viewerUserId);
      return { spaceId: profile.ok ? profile.value.spaceId : null };
    },
  });
  const clusterRunner = new AdapterAgentClusterRunner({
    userId: user.id,
    maxAgents: Number(
      process.env.TASK_WORKBENCH_LAB_MAX_AGENTS ||
        process.env.AGENT_CLUSTER_LAB_MAX_AGENTS ||
        3
    ),
    registry,
    onProviderEvent: callbacks.onProviderEvent,
    createAdapter: provider => {
      if (provider.runtimeFamily === "hermes")
        return new HermesProvider(provider);
      if (provider.runtimeFamily === "claude-code")
        return new ClaudeCodeProvider(provider);
      if (provider.runtimeFamily === "lingxia-local")
        return new StockAnalysisProvider(provider);
      return null;
    },
    resolveBinding: ({ definition, provider }) =>
      new LegacyBusinessAgentResolver().resolve(definition, provider),
  });
  return new JsonTaskTemplateRunner({
    clusterRunner,
    onTaskEvent: callbacks.onTaskEvent,
  });
}

function unauthorizedStatus(kind: string) {
  if (kind === "unauthorized") return 403;
  if (kind === "not_found") return 404;
  return 400;
}

function remoteHarnessExecutorEndpoint() {
  return (
    process.env.TASK_WORKBENCH_HARNESS_ENDPOINT ||
    process.env.LINGXIA_FIN_HARNESS_ENDPOINT ||
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT ||
    process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT ||
    ""
  ).trim();
}

function remoteHarnessExecutorEnabled() {
  return (
    String(
      process.env.TASK_WORKBENCH_HARNESS_EXECUTOR || "false"
    ).toLowerCase() === "true" && Boolean(remoteHarnessExecutorEndpoint())
  );
}

function remoteHarnessToken() {
  return (
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN ||
    process.env.TASK_WORKBENCH_HARNESS_TOKEN ||
    process.env.HERMES_HTTP_KEY ||
    ""
  );
}

function compactSummary(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function inferTaskArtifactType(templateId: string, prompt: string) {
  const lower = prompt.toLowerCase();
  if (templateId === "research_ppt") return "pptx";
  if (
    /\b(ppt|pptx|slide|slides|deck)\b/.test(lower) ||
    /PPT|幻灯片|路演|汇报材料/.test(prompt)
  )
    return "pptx";
  if (
    /\b(doc|docx|word)\b/.test(lower) ||
    /简报|报告|纪要|研究笔记|会议包/.test(prompt)
  )
    return "docx";
  return "docx";
}

function artifactFileStem(taskTemplateId: string, artifactType: string) {
  if (taskTemplateId === "research_ppt") return "研究型PPT";
  if (taskTemplateId === "video_outline") return "视频提纲";
  if (taskTemplateId === "meeting_notes") return "会议纪要";
  if (taskTemplateId === "excel_fill") return "Excel 填表";
  if (taskTemplateId === "meeting_prep_agent")
    return artifactType === "pptx" ? "客户会议准备材料" : "客户会议准备包";
  if (taskTemplateId === "market_research_brief")
    return artifactType === "pptx" ? "金融市场研究汇报" : "金融市场研究简报";
  return artifactType === "pptx" ? "任务汇报材料" : "任务交付文档";
}

type RemoteHarnessStage = z.infer<typeof remoteHarnessStageSchema>;
type RemoteHarnessExecuteResponse = z.infer<
  typeof remoteHarnessExecuteResponseSchema
>;
type HarnessPlan = z.infer<typeof taskWorkbenchHarnessPlanSchema>;

type FinanceDataPackEvidence = {
  id: string;
  requirementId: string;
  requirementType: string;
  provider: "wind-financial-docs";
  toolName: "get_company_announcements" | "get_financial_news";
  query: string;
  text: string;
  confidence: "medium" | "low";
  metadata?: Record<string, unknown>;
};

type FinanceDataPackGap = {
  id: string;
  requirementId: string;
  requirementType: string;
  query: string;
  reason: string;
  severity: "warning" | "error";
};

type FinanceDataPackSourceCard = {
  id: string;
  requirementId: string;
  title: string;
  snippet: string;
  url?: string;
  provider: "wind-financial-docs";
  toolName: "get_company_announcements" | "get_financial_news";
  confidence: "medium" | "low";
};

type FinanceDataPackSection = {
  requirementId: string;
  requirementType: string;
  title: string;
  query: string;
  reason?: string;
  required: boolean;
  status: "ready" | "partial" | "missing";
  confidence: "medium" | "low" | "missing";
  evidenceIds: string[];
  gapIds: string[];
};

type FinanceDataPack = {
  version: "v1.1";
  source: "employee-agent";
  provider: "wind-financial-docs";
  templateId: string;
  prompt: string;
  createdAt: string;
  requirements: NonNullable<HarnessPlan["dataRequirements"]>;
  sections: FinanceDataPackSection[];
  evidenceItems: FinanceDataPackEvidence[];
  sourceCards: FinanceDataPackSourceCard[];
  gaps: FinanceDataPackGap[];
  confidenceSummary: {
    level: "medium" | "low" | "missing";
    evidenceCount: number;
    gapCount: number;
    requiredGapCount: number;
    notes: string[];
  };
  missingInformation: string[];
  audit: {
    providerCalls: Array<{
      requirementId: string;
      provider: string;
      toolName?: string;
      query: string;
      topK?: number;
      ok: boolean;
      error?: string;
    }>;
  };
  markdown: string;
};

type FinanceComputePackItem = {
  id: string;
  type: NonNullable<HarnessPlan["computeRequirements"]>[number]["type"];
  inputRefs: string[];
  title: string;
  reason?: string;
  status: "completed" | "skipped";
  summary: string;
  table?: {
    columns: string[];
    rows: Array<Array<string | number>>;
  };
  gapIds: string[];
};

type FinanceComputePackGap = {
  id: string;
  computeId: string;
  type: string;
  reason: string;
  severity: "warning" | "error";
};

type FinanceComputePack = {
  version: "v1";
  source: "employee-agent";
  templateId: string;
  prompt: string;
  createdAt: string;
  requirements: NonNullable<HarnessPlan["computeRequirements"]>;
  computeItems: FinanceComputePackItem[];
  gaps: FinanceComputePackGap[];
  audit: {
    executions: Array<{
      computeId: string;
      type: string;
      inputRefs: string[];
      ok: boolean;
      error?: string;
    }>;
  };
  markdown: string;
};

function harnessRoleDisplayName(
  stage: Pick<RemoteHarnessStage, "role" | "profile">
) {
  const role = String(stage.role || "").toLowerCase();
  if (role === "reader") return `\u68c0\u7d22\u5458 \u00b7 ${stage.profile}`;
  if (role === "analyst") return `\u5206\u6790\u5e08 \u00b7 ${stage.profile}`;
  if (role === "writer") return `\u5199\u4f5c\u5458 \u00b7 ${stage.profile}`;
  return `${stage.role || "\u4e13\u5458"} \u00b7 ${stage.profile}`;
}

function financeDataPackAllowedForTemplate(templateId: string) {
  return templateId === "market_research_brief" || templateId === "meeting_prep_agent";
}

function windToolForRequirement(
  requirementType: string
): "get_company_announcements" | "get_financial_news" | null {
  if (requirementType === "company_announcements")
    return "get_company_announcements";
  if (
    [
      "financial_news",
      "company_profile",
      "stock_fundamentals",
      "market_snapshot",
      "macro_series",
      "fund_data",
      "bond_data",
    ].includes(requirementType)
  )
    return "get_financial_news";
  return null;
}

function financeRequirementLabel(requirementType: string) {
  return (
    {
      financial_news: "金融新闻与市场动态",
      company_announcements: "公司公告与监管披露",
      company_profile: "公司背景与业务画像",
      stock_fundamentals: "股票与基本面数据",
      market_snapshot: "市场概览",
      macro_series: "宏观指标",
      fund_data: "基金数据",
      bond_data: "债券数据",
      internal_context: "内部材料",
    }[requirementType] || requirementType || "数据需求"
  );
}

function extractFirstUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s)\]，。；、"'<>]+/i);
  return match?.[0];
}

function sourceTitleFromText(text: string, fallback: string) {
  const displayText = extractWindContentFieldsFromText(text) || text;
  const line = displayText
    .split(/\r?\n/)
    .map(item => item.trim())
    .find(item => item && !/^https?:\/\//i.test(item));
  return (line || fallback).replace(/^[-*#\s]+/, "").slice(0, 80);
}

function sourceSnippetFromText(text: string) {
  const displayText = extractWindContentFieldsFromText(text) || text;
  return displayText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function buildFinanceDataPackDerivedFields(input: {
  requirements: NonNullable<HarnessPlan["dataRequirements"]>;
  evidenceItems: FinanceDataPackEvidence[];
  gaps: FinanceDataPackGap[];
}): Pick<
  FinanceDataPack,
  "sections" | "sourceCards" | "confidenceSummary" | "missingInformation"
> {
  const sourceCards = input.evidenceItems.map(item => ({
    id: item.id,
    requirementId: item.requirementId,
    title: sourceTitleFromText(
      item.text,
      `${financeRequirementLabel(item.requirementType)} · ${item.query}`
    ),
    snippet: sourceSnippetFromText(item.text),
    url: extractFirstUrl(item.text),
    provider: item.provider,
    toolName: item.toolName,
    confidence: item.confidence,
  }));
  const sections = input.requirements.map(requirement => {
    const evidenceIds = input.evidenceItems
      .filter(item => item.requirementId === requirement.id)
      .map(item => item.id);
    const gapIds = input.gaps
      .filter(item => item.requirementId === requirement.id)
      .map(item => item.id);
    const hasEvidence = evidenceIds.length > 0;
    const hasGap = gapIds.length > 0;
    return {
      requirementId: requirement.id,
      requirementType: requirement.type,
      title: financeRequirementLabel(requirement.type),
      query: requirement.query,
      reason: requirement.reason,
      required: Boolean(requirement.required),
      status: hasEvidence ? (hasGap ? "partial" : "ready") : "missing",
      confidence: hasEvidence
        ? input.evidenceItems.some(
            item =>
              item.requirementId === requirement.id &&
              item.confidence === "medium"
          )
          ? "medium"
          : "low"
        : "missing",
      evidenceIds,
      gapIds,
    } satisfies FinanceDataPackSection;
  });
  const requiredGapCount = input.gaps.filter(gap =>
    input.requirements.some(
      requirement => requirement.id === gap.requirementId && requirement.required
    )
  ).length;
  const level =
    input.evidenceItems.length === 0
      ? "missing"
      : requiredGapCount > 0 || input.evidenceItems.every(item => item.confidence === "low")
        ? "low"
        : "medium";
  const missingInformation = input.gaps.map(
    gap => `${financeRequirementLabel(gap.requirementType)}：${gap.reason}`
  );
  const notes = [
    input.evidenceItems.length
      ? `已采用 ${input.evidenceItems.length} 条受控证据。`
      : "未采集到可用受控证据。",
    input.gaps.length ? `存在 ${input.gaps.length} 个数据缺口。` : "暂无显性数据缺口。",
    requiredGapCount ? `${requiredGapCount} 个必需数据需求未满足。` : "",
  ].filter(Boolean);
  return {
    sections,
    sourceCards,
    confidenceSummary: {
      level,
      evidenceCount: input.evidenceItems.length,
      gapCount: input.gaps.length,
      requiredGapCount,
      notes,
    },
    missingInformation,
  };
}

function financeDataPackToMarkdown(pack: Omit<FinanceDataPack, "markdown">) {
  const lines = [
    "# 受控金融数据包",
    "",
    `- 任务模板：${pack.templateId}`,
    `- 数据源：${pack.provider}`,
    `- 生成时间：${pack.createdAt}`,
    "",
    "## 数据需求",
    ...(pack.requirements.length
      ? pack.requirements.map(
          item =>
            `- ${item.id} · ${item.type} · ${item.query}${item.reason ? ` · ${item.reason}` : ""}`
        )
      : ["- 未提供数据需求。"]),
    "",
    "## 数据分组",
    ...(pack.sections.length
      ? pack.sections.map(
          item =>
            `- ${item.requirementId} · ${item.title} · ${item.status} · evidence ${item.evidenceIds.length} · gaps ${item.gapIds.length}`
        )
      : ["- 暂无数据分组。"]),
    "",
    "## 采用证据",
    ...(pack.evidenceItems.length
      ? pack.evidenceItems.map((item, index) =>
          [
            `### E${index + 1} ${item.requirementType} · ${item.toolName}`,
            `- query: ${item.query}`,
            `- confidence: ${item.confidence}`,
            "",
            item.text.slice(0, 4_000),
          ].join("\n")
        )
      : ["未采集到可用证据。"]),
    "",
    "## 缺口与降级",
    ...(pack.gaps.length
      ? pack.gaps.map(
          item =>
            `- ${item.severity.toUpperCase()} · ${item.id} · ${item.requirementId} · ${item.requirementType} · ${item.reason}`
        )
      : ["- 暂无显性缺口。"]),
    "",
    "## 置信摘要",
    `- level: ${pack.confidenceSummary.level}`,
    `- evidence: ${pack.confidenceSummary.evidenceCount}`,
    `- gaps: ${pack.confidenceSummary.gapCount}`,
    ...(pack.confidenceSummary.notes.length
      ? pack.confidenceSummary.notes.map(item => `- ${item}`)
      : []),
  ];
  return lines.join("\n");
}

function summarizeFinanceDataPack(pack?: FinanceDataPack | null) {
  if (!pack) return undefined;
  return {
    version: pack.version,
    provider: pack.provider,
    requirementCount: pack.requirements.length,
    evidenceCount: pack.evidenceItems.length,
    gapCount: pack.gaps.length,
    confidenceSummary: pack.confidenceSummary,
    sections: pack.sections.map(item => ({
      requirementId: item.requirementId,
      requirementType: item.requirementType,
      title: item.title,
      query: item.query,
      reason: item.reason,
      required: item.required,
      status: item.status,
      confidence: item.confidence,
      evidenceCount: item.evidenceIds.length,
      gapCount: item.gapIds.length,
    })),
    sourceCards: pack.sourceCards.map(item => ({
      id: item.id,
      requirementId: item.requirementId,
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      provider: item.provider,
      toolName: item.toolName,
      confidence: item.confidence,
    })),
    missingInformation: pack.missingInformation,
    providerCalls: pack.audit.providerCalls.map(item => ({
      requirementId: item.requirementId,
      provider: item.provider,
      toolName: item.toolName,
      query: item.query,
      topK: item.topK,
      ok: item.ok,
      error: item.error,
    })),
  };
}

function financeDataPackSummaryToSourceResearch(dataPack: unknown) {
  if (!dataPack || typeof dataPack !== "object") return undefined;
  const record = dataPack as Record<string, unknown>;
  const sections = Array.isArray(record.sections) ? record.sections : [];
  const sourceCards = Array.isArray(record.sourceCards)
    ? record.sourceCards
    : [];
  const missingInformation = Array.isArray(record.missingInformation)
    ? record.missingInformation.map(item => String(item)).filter(Boolean)
    : [];
  if (!sections.length && !sourceCards.length && !missingInformation.length)
    return undefined;
  const confidenceSummary =
    record.confidenceSummary && typeof record.confidenceSummary === "object"
      ? (record.confidenceSummary as Record<string, unknown>)
      : {};
  return {
    confidence: confidenceSummary.level || "low",
    searchPlan: {
      rationale: "由 Harness 规划数据需求，employee-agent 受控调用数据源并生成证据包。",
      queries: sections
        .map(section =>
          section && typeof section === "object"
            ? String((section as Record<string, unknown>).query || "")
            : ""
        )
        .filter(Boolean),
    },
    sources: sourceCards.map((item, index) => {
      const source = item as Record<string, unknown>;
      return {
        sourceId: source.id || `D${index + 1}`,
        url: source.url || "",
        title: source.title || "受控数据源",
        snippet: source.snippet || "",
        publisherClass: source.provider || "wind-financial-docs",
        evidenceRole: "controlled_data",
        sourceScore: {
          finalScore: source.confidence === "medium" ? 4 : 2,
        },
      };
    }),
    discardedSources: [],
    evidenceSummary: {
      controlledEvidenceCount: sourceCards.length,
      gapCount: Number(record.gapCount || 0),
    },
    missingInformation,
  };
}

function financeComputeLabel(type: string) {
  return (
    {
      none: "无需计算",
      time_series_metrics: "时间序列指标摘要",
      peer_comparison_table: "同业对比表",
      event_window_return: "事件窗口表现",
      financial_ratio_summary: "财务比率摘要",
      fund_performance_compare: "基金表现对比",
      excel_cleaning_summary: "表格清洗摘要",
    }[type] || type || "计算需求"
  );
}

function computeEvidenceRows(
  dataPack: FinanceDataPack | null | undefined,
  inputRefs: string[]
) {
  if (!dataPack) return [];
  const allowedRefs = new Set(inputRefs.filter(Boolean));
  const sections = dataPack.sections.filter(
    section => !allowedRefs.size || allowedRefs.has(section.requirementId)
  );
  return sections.map(section => {
    const sourceCount = dataPack.sourceCards.filter(
      source => source.requirementId === section.requirementId
    ).length;
    return {
      section,
      sourceCount,
      gapCount: section.gapIds.length,
    };
  });
}

function buildComputeTableForRequirement(
  requirement: NonNullable<HarnessPlan["computeRequirements"]>[number],
  dataPack: FinanceDataPack | null | undefined
): FinanceComputePackItem["table"] {
  const rows = computeEvidenceRows(dataPack, requirement.inputRefs || []);
  if (requirement.type === "none") return undefined;
  if (
    requirement.type === "peer_comparison_table" ||
    requirement.type === "financial_ratio_summary" ||
    requirement.type === "time_series_metrics" ||
    requirement.type === "fund_performance_compare" ||
    requirement.type === "event_window_return"
  ) {
    return {
      columns: ["维度", "查询", "证据数", "缺口数", "置信"],
      rows: rows.length
        ? rows.map(row => [
            row.section.title,
            row.section.query,
            row.sourceCount,
            row.gapCount,
            row.section.confidence,
          ])
        : [["数据覆盖", "无匹配 DataPack section", 0, 1, "missing"]],
    };
  }
  if (requirement.type === "excel_cleaning_summary") {
    return {
      columns: ["检查项", "结果"],
      rows: [
        ["输入引用", (requirement.inputRefs || []).join(", ") || "未指定"],
        ["处理方式", "当前阶段只生成清洗摘要，不执行任意脚本"],
      ],
    };
  }
  return undefined;
}

function financeComputePackToMarkdown(pack: Omit<FinanceComputePack, "markdown">) {
  const lines = [
    "# 受控计算包",
    "",
    `- 任务模板：${pack.templateId}`,
    `- 生成时间：${pack.createdAt}`,
    "",
    "## 计算需求",
    ...(pack.requirements.length
      ? pack.requirements.map(
          item =>
            `- ${item.id} · ${financeComputeLabel(item.type)} · inputRefs: ${(item.inputRefs || []).join(", ") || "none"}${item.reason ? ` · ${item.reason}` : ""}`
        )
      : ["- 未提供计算需求。"]),
    "",
    "## 计算结果",
    ...(pack.computeItems.length
      ? pack.computeItems.map(item =>
          [
            `### ${item.id} · ${item.title} · ${item.status}`,
            item.summary,
            item.table
              ? [
                  "",
                  `| ${item.table.columns.join(" | ")} |`,
                  `| ${item.table.columns.map(() => "---").join(" | ")} |`,
                  ...item.table.rows.map(row => `| ${row.map(cell => String(cell).replace(/\|/g, "/")).join(" | ")} |`),
                ].join("\n")
              : "",
          ].join("\n")
        )
      : ["- 暂无计算结果。"]),
    "",
    "## 计算缺口",
    ...(pack.gaps.length
      ? pack.gaps.map(
          item =>
            `- ${item.severity.toUpperCase()} · ${item.id} · ${item.computeId} · ${item.reason}`
        )
      : ["- 暂无显性计算缺口。"]),
  ];
  return lines.join("\n");
}

function summarizeFinanceComputePack(pack?: FinanceComputePack | null) {
  if (!pack) return undefined;
  return {
    version: pack.version,
    computeCount: pack.computeItems.length,
    gapCount: pack.gaps.length,
    computeItems: pack.computeItems.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      summary: item.summary,
      table: item.table,
      gapCount: item.gapIds.length,
    })),
    gaps: pack.gaps,
    executions: pack.audit.executions,
  };
}

function isHarnessReaderStage(stage: HarnessPlan["stages"][number]) {
  const role = String(stage.role || "").toLowerCase();
  const profile = String(stage.profile || "").toLowerCase();
  const stageId = String(stage.stageId || "").toLowerCase();
  const hasReaderToken = (value: string) => /(^|[-_])reader($|[-_])/.test(value);
  return role === "reader" || hasReaderToken(profile) || hasReaderToken(stageId);
}

function controlledRemoteHarnessPlan(
  harnessPlan?: HarnessPlan,
  financeDataPack?: FinanceDataPack | null,
  financeComputePack?: FinanceComputePack | null
): HarnessPlan | undefined {
  if (!harnessPlan) return undefined;
  if (
    harnessPlan.templateId !== "market-researcher" &&
    harnessPlan.templateId !== "meeting-prep-agent"
  )
    return harnessPlan;
  const hasControlledEvidence = Boolean(financeDataPack || financeComputePack);
  const stages = hasControlledEvidence
    ? harnessPlan.stages.filter(stage => !isHarnessReaderStage(stage))
    : harnessPlan.stages;
  return {
    ...harnessPlan,
    stages,
    reason: harnessPlan.reason
      ? `${harnessPlan.reason}；Reader 主路径由 employee-agent 受控数据/计算阶段替代。`
      : "Reader 主路径由 employee-agent 受控数据/计算阶段替代。",
  };
}

async function buildFinanceComputePackForHarness(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: HarnessPlan;
  dataPack?: FinanceDataPack | null;
}): Promise<FinanceComputePack | null> {
  if (!financeDataPackAllowedForTemplate(input.template.id)) return null;
  const requirements = input.harnessPlan?.computeRequirements || [];
  const actionableRequirements = requirements.filter(item => item.type !== "none");
  if (!actionableRequirements.length) return null;

  const computeItems: FinanceComputePackItem[] = [];
  const gaps: FinanceComputePackGap[] = [];
  const executions: FinanceComputePack["audit"]["executions"] = [];

  for (const requirement of actionableRequirements) {
    const inputRefs = requirement.inputRefs || [];
    const rows = computeEvidenceRows(input.dataPack, inputRefs);
    const hasUsableInput = rows.some(row => row.sourceCount > 0);
    const gapIds: string[] = [];
    if (!hasUsableInput) {
      const gap: FinanceComputePackGap = {
        id: `compute_gap_${gaps.length + 1}`,
        computeId: requirement.id,
        type: requirement.type,
        reason: "没有匹配到可用于该计算的 DataPack 证据，已生成结构化占位摘要。",
        severity: "warning",
      };
      gaps.push(gap);
      gapIds.push(gap.id);
    }
    const title = financeComputeLabel(requirement.type);
    const table = buildComputeTableForRequirement(requirement, input.dataPack);
    const summary = hasUsableInput
      ? `基于 ${rows.length} 个数据分组生成${title}，用于支撑后续分析判断。`
      : `未取得足够结构化数据，${title}仅作为待补充框架。`;
    computeItems.push({
      id: requirement.id,
      type: requirement.type,
      inputRefs,
      title,
      reason: requirement.reason,
      status: "completed",
      summary,
      table,
      gapIds,
    });
    executions.push({
      computeId: requirement.id,
      type: requirement.type,
      inputRefs,
      ok: true,
      error: hasUsableInput ? undefined : "insufficient_datapack_evidence",
    });
  }

  const draft: Omit<FinanceComputePack, "markdown"> = {
    version: "v1",
    source: "employee-agent",
    templateId: input.template.id,
    prompt: input.prompt,
    createdAt: new Date().toISOString(),
    requirements: actionableRequirements,
    computeItems,
    gaps,
    audit: { executions },
  };
  return {
    ...draft,
    markdown: financeComputePackToMarkdown(draft),
  };
}

async function buildFinanceDataPackForHarness(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: HarnessPlan;
}): Promise<FinanceDataPack | null> {
  if (!financeDataPackAllowedForTemplate(input.template.id)) return null;
  const requirements = input.harnessPlan?.dataRequirements || [];
  if (!requirements.length) return null;

  const evidenceItems: FinanceDataPackEvidence[] = [];
  const gaps: FinanceDataPackGap[] = [];
  const providerCalls: FinanceDataPack["audit"]["providerCalls"] = [];

  for (const requirement of requirements) {
    const toolName = windToolForRequirement(requirement.type);
    if (!toolName) {
      gaps.push({
        id: `gap_${gaps.length + 1}`,
        requirementId: requirement.id,
        requirementType: requirement.type,
        query: requirement.query,
        reason: "当前 Wind DataPack v1 暂不支持该数据需求类型，已跳过。",
        severity: requirement.required ? "error" : "warning",
      });
      continue;
    }
    const topK = Math.max(1, Math.min(20, requirement.topK || 5));
    const call = await callWindFinancialDocsTool({
      toolName,
      query: requirement.query || input.prompt,
      topK,
    });
    providerCalls.push({
      requirementId: requirement.id,
      provider: "wind-financial-docs",
      toolName,
      query: requirement.query || input.prompt,
      topK,
      ok: call.ok,
      error: call.ok ? undefined : call.error,
    });
    if (call.ok && call.text.trim()) {
      evidenceItems.push({
        id: `evidence_${evidenceItems.length + 1}`,
        requirementId: requirement.id,
        requirementType: requirement.type,
        provider: "wind-financial-docs",
        toolName,
        query: requirement.query || input.prompt,
        text: call.text.trim(),
        confidence: call.text.trim().length > 200 ? "medium" : "low",
        metadata: {
          skillDir: call.skillDir,
          topK,
        },
      });
    } else {
      gaps.push({
        id: `gap_${gaps.length + 1}`,
        requirementId: requirement.id,
        requirementType: requirement.type,
        query: requirement.query || input.prompt,
        reason: call.ok
          ? "数据源返回为空。"
          : call.error || "数据源调用失败。",
        severity: requirement.required ? "error" : "warning",
      });
    }
  }

  const derived = buildFinanceDataPackDerivedFields({
    requirements,
    evidenceItems,
    gaps,
  });
  const draft: Omit<FinanceDataPack, "markdown"> = {
    version: "v1.1",
    source: "employee-agent",
    provider: "wind-financial-docs",
    templateId: input.template.id,
    prompt: input.prompt,
    createdAt: new Date().toISOString(),
    requirements,
    sections: derived.sections,
    evidenceItems,
    sourceCards: derived.sourceCards,
    gaps,
    confidenceSummary: derived.confidenceSummary,
    missingInformation: derived.missingInformation,
    audit: { providerCalls },
  };
  return {
    ...draft,
    markdown: financeDataPackToMarkdown(draft),
  };
}

function materializeRemoteStageArtifacts(
  stage: RemoteHarnessStage,
  harnessRunId: string
): AgentArtifact[] {
  const rows = Array.isArray(stage.artifacts) ? stage.artifacts : [];
  const artifacts: AgentArtifact[] = [];
  rows.forEach((item, index) => {
    if (!item.contentBase64) return;
    let body: Buffer;
    try {
      body = Buffer.from(item.contentBase64, "base64");
    } catch {
      return;
    }
    if (!body.length) return;
    cleanupGeneratedArtifacts();
    const key = `${harnessRunId}-${stage.stageId}-${item.id || index}`;
    const mimeType = item.mimeType || "application/octet-stream";
    const fileName = item.name;
    const isWord =
      /\.docx?$/i.test(fileName) ||
      /officedocument\.wordprocessingml/i.test(mimeType);
    const artifactType = (
      isWord
        ? "file"
        : [
              "pptx",
              "html",
              "code",
              "markdown",
              "xlsx",
              "pdf",
              "image",
              "zip",
            ].includes(String(item.type))
          ? item.type
          : "file"
    ) as AgentArtifact["type"];
    generatedArtifacts.set(key, {
      fileName,
      mimeType,
      body,
      previewBody: isWord ? docxBufferToPreviewHtml(fileName, body) : undefined,
      previewMimeType: isWord ? "text/html; charset=utf-8" : undefined,
      createdAt: Date.now(),
    });
    artifacts.push({
      id: key,
      type: artifactType,
      name: fileName,
      mimeType,
      previewUrl: isWord
        ? `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}`
        : undefined,
      downloadUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}?download=1`,
      metadata: {
        ...(item.metadata || {}),
        source: item.metadata?.source || "remote-harness-artifact",
        size: item.size || body.length,
      },
    });
  });
  return artifacts;
}

function buildRemoteHarnessStage(
  stage: RemoteHarnessStage,
  harnessPlan: unknown
): TaskRunResult["stages"][number] {
  const now = new Date().toISOString();
  const output = stage.output || "";
  const failed = stage.status !== "success";
  const harnessRunId =
    harnessPlan && typeof harnessPlan === "object" && "runId" in harnessPlan
      ? String((harnessPlan as { runId?: unknown }).runId)
      : "remote-harness";
  const remoteArtifacts = materializeRemoteStageArtifacts(stage, harnessRunId);
  return {
    stageId: stage.stageId,
    personaId: (stage.role || stage.profile).toLowerCase(),
    agentDefinitionId: stage.profile,
    status: failed ? ("failed" as const) : ("success" as const),
    durationMs: stage.durationMs || 0,
    artifacts: remoteArtifacts,
    ownCitations: [],
    upstreamCitations: [],
    warnings: failed && stage.error ? [stage.error] : undefined,
    runResult: {
      id: stage.runId || `${harnessRunId}-${stage.stageId}`,
      envelopeVersion: "v1" as const,
      agentDefinitionId: stage.profile,
      status: failed ? ("failed" as const) : ("success" as const),
      summary: output ? compactSummary(output) : undefined,
      output,
      artifacts: remoteArtifacts,
      metadata: {
        remoteHarness: true,
        role: stage.role,
        profile: stage.profile,
        usage: stage.usage,
        skillRefs: stage.skillRefs,
        schemaRef: stage.schemaRef || undefined,
        schemaPayload: stage.schemaPayload || undefined,
        schemaErrors: stage.schemaErrors || [],
        searchProviders: stage.searchProviders || [],
        searchProvidersAttempted: stage.searchProvidersAttempted || [],
        searchResultCount: stage.searchResultCount || 0,
        searchErrors: stage.searchErrors || [],
        sourceResearch:
          stage.sourceResearch ||
          financeDataPackSummaryToSourceResearch(stage.dataPack) ||
          undefined,
        dataPack: stage.dataPack || undefined,
        computePack: stage.computePack || undefined,
        artifactType: stage.artifactType || undefined,
        permissionPolicy: stage.permissionPolicy,
        manifestWorker: stage.manifestWorker,
      },
      error: failed
        ? {
            code: "remote_harness_stage_failed",
            detail: stage.error || "remote harness stage failed",
          }
        : undefined,
      producedAt: now,
    },
  };
}

function buildRemoteHarnessTaskRun(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
  financeDataPack?: FinanceDataPack | null;
  financeComputePack?: FinanceComputePack | null;
  response: RemoteHarnessExecuteResponse;
}): TaskRunResult {
  const now = new Date().toISOString();
  const harnessPlan = taskWorkbenchHarnessPlanSchema.safeParse(
    input.response.harnessPlan
  ).success
    ? taskWorkbenchHarnessPlanSchema.parse(input.response.harnessPlan)
    : input.harnessPlan;
  const harnessRunId = harnessPlan?.runId || `remote-${Date.now()}`;
  const stages = input.response.stages.map(stage =>
    buildRemoteHarnessStage(stage, harnessPlan)
  );
  const artifacts = stages.flatMap(stage => stage.artifacts || []);
  const taskStatus =
    input.response.status === "completed" &&
    stages.every(stage => stage.status === "success")
      ? ("completed" as const)
      : stages.some(stage => stage.status === "success")
        ? ("partial_success" as const)
        : ("failed" as const);
  return {
    taskRunId: `remote-harness-${harnessRunId}`,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `remote-harness:${harnessRunId}:${input.template.version}`,
    status: taskStatus,
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType:
        input.response.artifactType ||
        inferTaskArtifactType(input.template.id, input.prompt),
      harnessPlan,
      financeDataPack: summarizeFinanceDataPack(input.financeDataPack),
      financeComputePack: summarizeFinanceComputePack(
        input.financeComputePack
      ),
      remoteHarness: {
        enabled: true,
        status: input.response.status,
        endpointRef: "TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT",
      },
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `remote-harness:${harnessRunId}:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt: now,
    completedAt: new Date().toISOString(),
  };
}

function postRemoteHarnessJson(
  urlString: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; statusCode: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const serializedBody = JSON.stringify(body);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "POST",
        timeout: REMOTE_HARNESS_EXECUTE_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(serializedBody),
          authorization: `Bearer ${token}`,
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload: unknown = null;
          if (raw.trim()) {
            try {
              payload = JSON.parse(raw);
            } catch {
              payload = { raw: raw.slice(0, 1000) };
            }
          }
          const statusCode = response.statusCode || 0;
          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            payload,
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error(
          `remote harness executor timed out after ${REMOTE_HARNESS_EXECUTE_TIMEOUT_MS}ms`
        )
      );
    });
    request.on("error", reject);
    request.write(serializedBody);
    request.end();
  });
}

async function executeRemoteHarness(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
  financeDataPack?: FinanceDataPack | null;
  financeComputePack?: FinanceComputePack | null;
}): Promise<
  { ok: true; value: TaskRunResult } | { ok: false; error: AgentRegistryError }
> {
  const endpoint = remoteHarnessExecutorEndpoint();
  const token = remoteHarnessToken();
  const harnessPlan = controlledRemoteHarnessPlan(
    input.harnessPlan,
    input.financeDataPack,
    input.financeComputePack
  );
  if (!endpoint || !token) {
    return {
      ok: false,
      error: {
        kind: "provider_unhealthy",
        detail: "remote harness executor is not configured",
      },
    };
  }

  let response: { ok: boolean; statusCode: number; payload: unknown };
  try {
    response = await postRemoteHarnessJson(
      `${endpoint.replace(/\/+$/, "")}${input.harnessPlan ? "/v1/harness/execute" : "/v1/harness/run"}`,
      token,
      {
        prompt: input.prompt,
        artifact_type: inferTaskArtifactType(input.template.id, input.prompt),
        selected_template_id:
          input.template.id === "market_research_brief"
            ? "market-researcher"
            : input.template.id === "meeting_prep_agent"
              ? "meeting-prep-agent"
              : null,
        harnessPlan,
        financeDataPack: input.financeDataPack || undefined,
        financeComputePack: input.financeComputePack || undefined,
      }
    );
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "provider_unhealthy",
        detail: `remote harness executor request failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "dispatch_failed",
        detail: `remote harness executor failed: ${JSON.stringify(response.payload).slice(0, 300)}`,
      },
    };
  }
  const parsed = remoteHarnessExecuteResponseSchema.safeParse(response.payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "validation_failed",
        detail: `invalid remote harness response: ${parsed.error.message}`,
      },
    };
  }

  return {
    ok: true,
    value: buildRemoteHarnessTaskRun({
      template: input.template,
      prompt: input.prompt,
      harnessPlan,
      financeDataPack: input.financeDataPack,
      financeComputePack: input.financeComputePack,
      response: parsed.data,
    }),
  };
}

type RemoteHarnessStreamCallbacks = {
  onStageStarted?: (event: Record<string, unknown>) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
};

async function executeRemoteHarnessStream(
  input: {
    template: TaskTemplate;
    prompt: string;
    harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
    financeDataPack?: FinanceDataPack | null;
    financeComputePack?: FinanceComputePack | null;
  },
  callbacks: RemoteHarnessStreamCallbacks = {}
): Promise<
  { ok: true; value: TaskRunResult } | { ok: false; error: AgentRegistryError }
> {
  const endpoint = remoteHarnessExecutorEndpoint();
  const token = remoteHarnessToken();
  const harnessPlan = controlledRemoteHarnessPlan(
    input.harnessPlan,
    input.financeDataPack,
    input.financeComputePack
  );
  if (!endpoint || !token) {
    return {
      ok: false,
      error: {
        kind: "provider_unhealthy",
        detail: "remote harness executor is not configured",
      },
    };
  }

  const response = await fetch(
    `${endpoint.replace(/\/+$/, "")}${input.harnessPlan ? "/v1/harness/execute-stream" : "/v1/harness/run-stream"}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        artifact_type: inferTaskArtifactType(input.template.id, input.prompt),
        selected_template_id:
          input.template.id === "market_research_brief"
            ? "market-researcher"
            : input.template.id === "meeting_prep_agent"
              ? "meeting-prep-agent"
              : null,
        harnessPlan,
        financeDataPack: input.financeDataPack || undefined,
        financeComputePack: input.financeComputePack || undefined,
      }),
    }
  );
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      error: {
        kind: "dispatch_failed",
        detail: `remote harness stream failed: ${response.status} ${detail.slice(0, 300)}`,
      },
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: RemoteHarnessExecuteResponse | null = null;

  const handleSseBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.replace(/^data:\s?/, ""));
    if (!dataLines.length) return;
    const raw = dataLines.join("\n").trim();
    if (!raw || raw === "[DONE]") return;
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const type = String(payload.type || "");
    if (
      type === "stage_started" &&
      payload.event &&
      typeof payload.event === "object"
    ) {
      callbacks.onStageStarted?.({
        stageId: payload.event.stageId,
        agentDefinitionId:
          payload.event.agentDefinitionId || payload.event.profile,
        displayName: payload.event.displayName,
        role: payload.event.role,
        profile: payload.event.profile,
        skillRefs: payload.event.skillRefs,
        permissionPolicy: payload.event.permissionPolicy,
        manifestWorker: payload.event.manifestWorker,
      });
      return;
    }
    if (type === "stage_done") {
      const parsedStage = remoteHarnessStageSchema.safeParse(payload.stage);
      if (parsedStage.success) {
        callbacks.onStageDone?.(
          buildRemoteHarnessStage(
            parsedStage.data,
            payload.harnessPlan || harnessPlan
          )
        );
      }
      return;
    }
    if (type === "run_done") {
      const parsedResult = remoteHarnessExecuteResponseSchema.safeParse(
        payload.result
      );
      if (parsedResult.success) finalPayload = parsedResult.data;
    }
  };

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) handleSseBlock(block);
    }
    if (done) break;
  }
  if (buffer.trim()) handleSseBlock(buffer);
  if (!finalPayload) {
    return {
      ok: false,
      error: {
        kind: "dispatch_failed",
        detail: "remote harness stream ended without run_done",
      },
    };
  }
  return {
    ok: true,
    value: buildRemoteHarnessTaskRun({
      template: input.template,
      prompt: input.prompt,
      harnessPlan,
      financeDataPack: input.financeDataPack,
      financeComputePack: input.financeComputePack,
      response: finalPayload,
    }),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownishToHtml(markdown: string) {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  let inList = false;
  const out: string[] = [];
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      closeList();
      const level = Math.min(3, line.match(/^#+/)?.[0].length || 2);
      out.push(
        `<h${level}>${escapeHtml(line.replace(/^#+\s+/, ""))}</h${level}>`
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function decodeXmlText(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function docxBufferToText(buffer: Buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry("word/document.xml");
    if (!entry) return "";
    const xml = entry.getData().toString("utf8");
    const paragraphs: string[] = [];
    const paragraphMatches = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    for (const paragraph of paragraphMatches) {
      const parts: string[] = [];
      const runMatches =
        paragraph.match(/<w:t[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) || [];
      for (const run of runMatches) {
        if (run.startsWith("<w:tab")) {
          parts.push(" ");
        } else if (run.startsWith("<w:br")) {
          parts.push("\n");
        } else {
          parts.push(
            decodeXmlText(
              run.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "")
            )
          );
        }
      }
      const text = parts.join("").replace(/\s+\n/g, "\n").trim();
      if (text) paragraphs.push(text);
    }
    return paragraphs.join("\n\n").trim();
  } catch {
    return "";
  }
}

function docxBufferToPreviewHtml(fileName: string, buffer: Buffer) {
  const title = fileName.replace(/\.docx?$/i, "") || "Word 文档";
  const text = docxBufferToText(buffer);
  if (!text)
    return buildWordCompatibleHtml(
      title,
      "无法读取 Word 正文。请下载文件后查看。"
    );
  return buildWordCompatibleHtml(title, text);
}

function buildWordCompatibleHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif; color: #1f2937; font-size: 13px; line-height: 1.58; padding: 24px 32px; }
    h1 { color: #0f3a5f; font-size: 20px; border-left: 4px solid #0f3a5f; padding-left: 12px; margin: 0 0 16px; }
    h2 { color: #0f3a5f; font-size: 16px; margin: 20px 0 8px; }
    h3 { color: #334155; font-size: 14px; margin: 14px 0 6px; }
    p { margin: 7px 0; }
    ul { margin: 7px 0 7px 20px; }
    .disclaimer { margin-top: 20px; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #94a3b8; color: #475569; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${markdownishToHtml(body)}
  <div class="disclaimer">本报告由 AI 助手生成，仅用于数据研究与风险提示，不构成投资建议、买卖建议或收益承诺。投资有风险，决策需谨慎。</div>
</body>
</html>`;
}

function buildOpenClawTaskPrompt(templateId: string, prompt: string) {
  const isMeeting = templateId === "meeting_prep_agent";
  const title = isMeeting ? "客户会议准备包" : "金融市场研究简报";
  const sections = isMeeting
    ? [
        "## 会议目标理解",
        "## 客户/机构背景",
        "## 近期动态与信号",
        "## 可能关注点与需求假设",
        "## 建议议程",
        "## 关键提问清单",
        "## 沟通要点",
        "## 风险与待确认事项",
        "## 下一步动作",
      ]
    : [
        "## 任务理解",
        "## 核心结论",
        "## 关键趋势与事实信号",
        "## 背后原因",
        "## 企业影响",
        "## 机会与风险",
        "## 建议动作",
        "## 来源线索与待复核项",
      ];
  return [
    `你是企业办公工作流执行器。请完成「${title}」任务。`,
    "",
    "要求：",
    "1. 输出中文 Markdown。",
    "2. 内容要结构化、可交付，适合直接给业务负责人审阅。",
    "3. 如果需要事实资料，请尽量使用当前运行时可用的搜索、网页读取或文件读取能力；如果无法检索，要明确写出假设和待复核项，不要编造。",
    "4. 不要向用户追问，基于已有信息生成初稿。",
    "5. 每个关键判断尽量给出来源线索或复核方向。",
    "6. 结论要具体，避免空泛口号。",
    "",
    "用户输入：",
    prompt,
    "",
    "请严格按以下章节输出：",
    `# ${title}`,
    ...sections,
  ].join("\n");
}

async function callOpenClawTask(args: {
  claw: any;
  adoptId: string;
  prompt: string;
  timeoutMs?: number;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const runtimeAgentId = resolveRuntimeAgentId(
    args.adoptId,
    String(args.claw?.agentId || "")
  );
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId,
    channel: "office",
    conversationId: `task-workbench-${Date.now()}`,
  });
  const rawProfile = String(args.claw?.permissionProfile || "starter");
  const permissionProfile: PermissionProfile =
    rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";
  const body = Buffer.from(
    JSON.stringify(
      buildChatRequestBody({
        message: args.prompt,
        permissionProfile,
        brandSystemPrompt:
          "你是企业办公工作流执行器。请产出可审阅、可归档、可复核的业务交付物。",
      })
    ),
    "utf8"
  );

  return await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: remoteHost,
        port: gatewayPort,
        path: "/v1/chat/completions",
        method: "POST",
        timeout: 0,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Authorization: `Bearer ${gatewayToken}`,
          "x-openclaw-agent-id": runtimeAgentId,
          "x-openclaw-session-key": sessionKey,
        },
      },
      res => {
        let buffer = "";
        let out = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            for (const rawLine of block.split("\n")) {
              const line = rawLine.trimEnd();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content || "";
                if (delta) out += delta;
              } catch {}
            }
          }
        });
        res.on("end", () => {
          const text = out.trim();
          if (!text) reject(new Error("OpenClaw 返回结果为空"));
          else resolve(text);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(args.timeoutMs || 300_000, () =>
      req.destroy(new Error("OpenClaw task-workbench 处理超时"))
    );
    req.write(body);
    req.end();
  });
}

async function runOpenClawTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
}): Promise<TaskRunResult> {
  if (!input.user.adoptId || !input.user.claw)
    throw new Error("openclaw_user_context_missing");
  const now = new Date().toISOString();
  const output = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    prompt: buildOpenClawTaskPrompt(input.template.id, input.prompt),
    timeoutMs: input.template.maxDurationMs || 600_000,
  });
  const writerStageId =
    input.template.id === "meeting_prep_agent" ? "pack_writer" : "note_writer";
  const writerAgentId =
    input.template.id === "meeting_prep_agent"
      ? "openclaw-meeting-pack-writer"
      : "openclaw-market-note-writer";
  const stage = {
    stageId: writerStageId,
    personaId: "writer",
    agentDefinitionId: writerAgentId,
    status: "success" as const,
    durationMs: 0,
    artifacts: [],
    ownCitations: [],
    upstreamCitations: [],
    runResult: {
      id: `openclaw-${Date.now()}`,
      envelopeVersion: "v1" as const,
      agentDefinitionId: writerAgentId,
      status: "success" as const,
      summary: compactSummary(output),
      output,
      artifacts: [],
      metadata: {
        role: "writer",
        runtime: "openclaw",
        artifactType: "docx",
      },
      producedAt: new Date().toISOString(),
    },
  };
  return {
    taskRunId: `openclaw-${input.template.id}-${Date.now()}`,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `openclaw:${input.template.id}:${input.template.version}`,
    status: "completed",
    stages: [stage],
    artifacts: [],
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: "docx",
      runtime: "openclaw",
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `openclaw:${input.template.id}:${input.template.version}`,
      stageSnapshots: [],
    },
    startedAt: now,
    completedAt: new Date().toISOString(),
  };
}

function buildResearchPptPrompt(prompt: string) {
  return [
    "你是企业办公 PPT 研究与大纲工作流。请完成研究型 PPT 的前三步：资料检索、综合分析、PPT 大纲蓝图。",
    "",
    "工作方式：",
    "1. 如果主题涉及热点、最新趋势、政策、公司或市场动态，优先使用可用的网页搜索/网页抓取工具获取资料。",
    "2. 不要生成 PPTX 文件。只输出可审核 Markdown 和机器可读的 PPT_BLUEPRINT_JSON。",
    "3. 不要向用户追问。信息不足时写明假设、缺口和待人工复核项。",
    "4. 事实、日期、机构、数字必须可追溯；不确定内容必须标注不确定性。",
    "",
    "请严格按以下章节输出：",
    "# 研究型 PPT 大纲",
    "## 资料检索包",
    "- 列出检索问题、来源标题、URL、日期、关键信息和不确定性。",
    "## 分析判断",
    "- 提炼核心观点、逻辑主线、关键风险、证据缺口。",
    "## PPT 大纲",
    "- 每页写：页码、页面类型、标题、关键结论、3-5 个要点、视觉建议、引用来源。",
    "## 需要用户补充的信息",
    "## PPT_BLUEPRINT_JSON",
    "最后必须追加一个 fenced code block，语言标记必须是 PPT_BLUEPRINT_JSON。",
    "JSON 格式如下，slides 6-10 页为宜：",
    "```PPT_BLUEPRINT_JSON",
    JSON.stringify(
      {
        version: "v1",
        title: "演示文稿标题",
        subtitle: "使用场景或受众",
        slides: [
          {
            pageNo: 1,
            type: "cover",
            title: "主题标签：观点标题",
            keyMessage: "本页一句话主张",
            bullets: [{ text: "可直接进入页面的短要点", citationRefs: [] }],
            mustInclude: ["必须进入最终 PPT 的关键判断或事实"],
            businessImplications: ["对企业、业务、组织或管理的启示"],
            recommendedActions: ["可执行下一步"],
            evidenceNotes: ["支撑本页判断的来源线索"],
            evidence: ["来源名称 | 来源标题 | URL | 日期"],
            assumptions: ["信息不足时采用的假设"],
            risks: ["需要人工复核的不确定点"],
            layoutPriority: "content",
            visualIntent: "content-cards",
            visualData: {
              items: [{ label: "维度", value: "短判断", note: "补充说明" }],
            },
            speakerNotes: "汇报口径",
          },
        ],
      },
      null,
      2
    ),
    "```",
    "",
    "PPT_BLUEPRINT_JSON 规则：",
    "- slides 必须与 Markdown 大纲逐页一致。",
    "- title 要短，优先使用「四字标签：观点」或「主题：观点」格式。",
    "- 除封面外，每页至少 4 条 bullets，并补充 mustInclude/businessImplications/recommendedActions/evidenceNotes。",
    "- visualIntent 从 cover、agenda、content-cards、compare-two-column、process-flow、timeline、matrix-2x2、kpi-cards、bar-chart、table、summary 中选择。",
    "- visualData.items 要可上屏，不要只写抽象名词。",
    "- 不要编造来源，不要编造精确数字。",
    "",
    "用户要求：",
    prompt,
  ].join("\n");
}

type ResearchPptOutlineResult = {
  outline: string;
  sourceOutput: string;
  analysisOutput: string;
  outlineOutput: string;
  runtime: "openclaw" | "hermes";
  stageRunIds?: Record<string, string>;
  fallbackReason?: string;
  stages?: TaskRunResult["stages"];
};

function researchPptHermesEnabled() {
  const explicit =
    process.env.TASK_WORKBENCH_RESEARCH_PPT_HERMES ??
    process.env.RESEARCH_PPT_HERMES_ENABLED;
  if (explicit !== undefined) return String(explicit).toLowerCase() === "true";
  return Boolean(
    process.env.LINGXIA_PPT_SOURCE_READER_ENDPOINT &&
      process.env.LINGXIA_PPT_INSIGHT_ANALYST_ENDPOINT &&
      process.env.LINGXIA_PPT_OUTLINE_WRITER_ENDPOINT
  );
}

function buildPptSourceReaderPrompt(prompt: string) {
  return [
    "请作为研究型 PPT 的检索员处理用户需求。",
    "",
    "目标：只做资料检索和证据整理，不写 PPT，不输出 PPT_BLUEPRINT_JSON。",
    "要求：",
    "- 如果主题涉及最新政策、热点、公司、市场或技术趋势，优先搜索公开资料。",
    "- 每条来源写清标题、URL、发布日期或访问日期、关键信息、不确定性。",
    "- 标出资料缺口和需要人工复核的事实。",
    "- 输出中文 Markdown，章节固定为：# 资料检索包、## 检索问题、## 来源清单、## 关键事实、## 缺口与风险。",
    "",
    "用户要求：",
    prompt,
  ].join("\n");
}

function buildPptInsightAnalystPrompt(prompt: string, sourceOutput: string) {
  return [
    "请作为研究型 PPT 的分析师处理上游检索结果。",
    "",
    "目标：提炼汇报主线、核心观点、业务启示、风险缺口，不写 PPTX 文件。",
    "输出中文 Markdown，章节固定为：# 分析判断、## 核心观点、## 逻辑主线、## 业务启示、## 风险与缺口、## 建议页结构。",
    "",
    "用户要求：",
    prompt,
    "",
    "上游资料检索包：",
    sourceOutput,
  ].join("\n");
}

function buildPptOutlineWriterPrompt(
  prompt: string,
  sourceOutput: string,
  analysisOutput: string
) {
  return [
    "请作为研究型 PPT 的大纲员，把上游资料和分析转成可审核大纲和机器可读蓝图。",
    "",
    "不要生成 PPTX 文件。必须输出中文 Markdown，并在最后追加一个 fenced code block，语言标记必须是 PPT_BLUEPRINT_JSON。",
    "输出章节固定为：",
    "# 研究型 PPT 大纲",
    "## 资料检索包",
    "## 分析判断",
    "## PPT 大纲",
    "## 需要用户补充的信息",
    "## PPT_BLUEPRINT_JSON",
    "",
    "PPT_BLUEPRINT_JSON 格式如下，slides 6-10 页为宜：",
    "```PPT_BLUEPRINT_JSON",
    JSON.stringify(
      {
        version: "v1",
        title: "演示文稿标题",
        subtitle: "使用场景或受众",
        slides: [
          {
            pageNo: 1,
            type: "cover",
            title: "主题标签：观点标题",
            keyMessage: "本页一句话主张",
            bullets: [{ text: "可直接进入页面的短要点", citationRefs: [] }],
            mustInclude: ["必须进入最终 PPT 的关键判断或事实"],
            businessImplications: ["对企业、业务、组织或管理的启示"],
            recommendedActions: ["可执行下一步"],
            evidenceNotes: ["支撑本页判断的来源线索"],
            evidence: ["来源名称 | 来源标题 | URL | 日期"],
            assumptions: ["信息不足时采用的假设"],
            risks: ["需要人工复核的不确定点"],
            layoutPriority: "content",
            visualIntent: "content-cards",
            visualData: {
              items: [{ label: "维度", value: "短判断", note: "补充说明" }],
            },
            speakerNotes: "汇报口径",
          },
        ],
      },
      null,
      2
    ),
    "```",
    "",
    "规则：",
    "- Markdown 大纲和 PPT_BLUEPRINT_JSON 必须逐页一致。",
    "- 除封面外，每页至少 4 条 bullets，并补充 mustInclude/businessImplications/recommendedActions/evidenceNotes。",
    "- visualIntent 从 cover、agenda、content-cards、compare-two-column、process-flow、timeline、matrix-2x2、kpi-cards、bar-chart、table、summary 中选择。",
    "- 不要编造来源，不要编造精确数字；缺口写入 assumptions/risks。",
    "",
    "用户要求：",
    prompt,
    "",
    "上游资料检索包：",
    sourceOutput,
    "",
    "上游分析判断：",
    analysisOutput,
  ].join("\n");
}

async function loadLegacyHermesProvider(
  registry: JsonAgentRegistry
): Promise<AgentProvider> {
  const providers = await registry.listProviders();
  if (!providers.ok) throw new Error(providers.error.detail);
  const provider = providers.value.find(item => item.id === "legacy-hermes");
  if (!provider) throw new Error("legacy_hermes_provider_missing");
  return provider;
}

async function dispatchManagedHermesStage(input: {
  user: LabUser;
  agentDefinitionId: string;
  prompt: string;
  clusterRunId: string;
  onEvent?: (event: ProviderStreamEvent) => void;
}): Promise<AgentRunResult> {
  const registry = new JsonAgentRegistry();
  const definitionResult = await registry.getDefinition(
    input.agentDefinitionId
  );
  if (!definitionResult.ok) throw new Error(definitionResult.error.detail);
  const provider = await loadLegacyHermesProvider(registry);
  const resolved = await new LegacyBusinessAgentResolver().resolve(
    definitionResult.value,
    provider
  );
  if (!resolved.ok) throw new Error(resolved.error.detail);
  const dispatch = await new HermesProvider(provider).dispatch({
    provider,
    definition: definitionResult.value,
    prompt: input.prompt,
    resolved: resolved.value,
    context: {
      adoptId: input.user.adoptId || "unknown",
      userId: input.user.id,
      agentId: input.agentDefinitionId,
      profileRef: definitionResult.value.profileRef,
      clusterRunId: input.clusterRunId,
      timeoutMs: definitionResult.value.timeoutMs || provider.timeoutMs,
    },
    onEvent: input.onEvent,
  });
  if (!dispatch.ok) throw new Error(dispatch.error.detail);
  if (dispatch.value.status !== "success") {
    throw new Error(
      dispatch.value.error?.detail || `${input.agentDefinitionId}_failed`
    );
  }
  return dispatch.value;
}

async function tryRunResearchPptHermesOutline(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  taskRunId: string;
  onStageStarted?: (stageId: string) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
}): Promise<ResearchPptOutlineResult | null> {
  if (!researchPptHermesEnabled()) return null;
  try {
    const stages: TaskRunResult["stages"] = [];
    input.onStageStarted?.("source_reader");
    const sourceRun = await dispatchManagedHermesStage({
      user: input.user,
      agentDefinitionId: "ppt-source-reader",
      prompt: buildPptSourceReaderPrompt(input.prompt),
      clusterRunId: input.taskRunId,
      onEvent: event =>
        input.onProviderEvent?.({
          ...event,
          agentDefinitionId: "ppt-source-reader",
        }),
    });
    const sourceOutput = String(
      sourceRun.output || sourceRun.summary || ""
    ).trim();
    const sourceStage = makeResearchPptStage({
      stageId: "source_reader",
      personaId: "reader",
      agentDefinitionId: "ppt-source-reader",
      output: sourceOutput || "已完成资料检索和来源梳理，详见大纲文件。",
      metadata: {
        role: "Reader",
        profile: "ppt-source-reader",
        runtime: "hermes",
        runId: sourceRun.id,
      },
    });
    stages.push(sourceStage);
    input.onStageDone?.(sourceStage);
    input.onStageStarted?.("insight_analyst");
    const analysisRun = await dispatchManagedHermesStage({
      user: input.user,
      agentDefinitionId: "ppt-insight-analyst",
      prompt: buildPptInsightAnalystPrompt(input.prompt, sourceOutput),
      clusterRunId: input.taskRunId,
      onEvent: event =>
        input.onProviderEvent?.({
          ...event,
          agentDefinitionId: "ppt-insight-analyst",
        }),
    });
    const analysisOutput = String(
      analysisRun.output || analysisRun.summary || ""
    ).trim();
    const analysisStage = makeResearchPptStage({
      stageId: "insight_analyst",
      personaId: "analyst",
      agentDefinitionId: "ppt-insight-analyst",
      output:
        analysisOutput ||
        "已完成逻辑线、核心观点和风险缺口提炼，详见大纲文件。",
      metadata: {
        role: "Analyst",
        profile: "ppt-insight-analyst",
        runtime: "hermes",
        runId: analysisRun.id,
      },
    });
    stages.push(analysisStage);
    input.onStageDone?.(analysisStage);
    input.onStageStarted?.("outline_writer");
    const writerRun = await dispatchManagedHermesStage({
      user: input.user,
      agentDefinitionId: "ppt-outline-writer",
      prompt: buildPptOutlineWriterPrompt(
        input.prompt,
        sourceOutput,
        analysisOutput
      ),
      clusterRunId: input.taskRunId,
      onEvent: event =>
        input.onProviderEvent?.({
          ...event,
          agentDefinitionId: "ppt-outline-writer",
        }),
    });
    const outline = String(writerRun.output || writerRun.summary || "").trim();
    if (!outline) throw new Error("ppt_outline_writer_empty_output");
    return {
      outline,
      sourceOutput: sourceOutput || "已完成资料检索和来源梳理，详见大纲文件。",
      analysisOutput:
        analysisOutput ||
        "已完成逻辑线、核心观点和风险缺口提炼，详见大纲文件。",
      outlineOutput: markdownSection(outline, "PPT 大纲") || outline,
      runtime: "hermes",
      stageRunIds: {
        source_reader: sourceRun.id,
        insight_analyst: analysisRun.id,
        outline_writer: writerRun.id,
      },
      stages,
    };
  } catch (error: any) {
    console.warn(
      "[TASK-WORKBENCH-LAB] research_ppt Hermes outline failed; falling back to OpenClaw",
      {
        error: error?.message || String(error),
      }
    );
    return null;
  }
}

async function runResearchPptOpenClawOutline(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
}): Promise<ResearchPptOutlineResult> {
  const outline = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId || "",
    prompt: buildResearchPptPrompt(input.prompt),
    timeoutMs: input.template.maxDurationMs || 600_000,
  });
  return {
    outline,
    sourceOutput:
      markdownSection(outline, "资料检索包") ||
      "已完成资料检索和来源梳理，详见大纲文件。",
    analysisOutput:
      markdownSection(outline, "分析判断") ||
      "已完成逻辑线、核心观点和风险缺口提炼，详见大纲文件。",
    outlineOutput: markdownSection(outline, "PPT 大纲") || outline,
    runtime: "openclaw",
  };
}

function markdownSection(markdown: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i")
  );
  return (match?.[2] || "").trim();
}

function workspaceDownloadUrl(adoptId: string, rel: string) {
  return `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(rel)}`;
}

function workspaceArtifact(args: {
  user: LabUser;
  rel: string;
  type: AgentArtifact["type"];
  mimeType: string;
  preview?: boolean;
  language?: string;
}): AgentArtifact {
  const abs = path.join(args.user.workspace || "", args.rel);
  const size = existsSync(abs) ? statSync(abs).size : undefined;
  const url = workspaceDownloadUrl(args.user.adoptId || "", args.rel);
  return {
    id: `workspace:${args.rel}`,
    type: args.type,
    name: path.basename(args.rel),
    mimeType: args.mimeType,
    language: args.language,
    previewUrl: args.preview ? url : undefined,
    downloadUrl: url,
    metadata: {
      source: "task-workbench-workspace",
      workspacePath: args.rel,
      size,
    },
  };
}

function makeResearchPptStage(args: {
  stageId: string;
  personaId: string;
  agentDefinitionId: string;
  status?: "success" | "failed";
  output: string;
  artifacts?: AgentArtifact[];
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): TaskRunResult["stages"][number] {
  return {
    stageId: args.stageId,
    personaId: args.personaId,
    agentDefinitionId: args.agentDefinitionId,
    status: args.status || "success",
    durationMs: args.durationMs || 0,
    artifacts: args.artifacts || [],
    ownCitations: [],
    upstreamCitations: [],
    runResult: {
      id: `${args.stageId}-${Date.now()}`,
      envelopeVersion: "v1",
      agentDefinitionId: args.agentDefinitionId,
      status: args.status || "success",
      summary: compactSummary(args.output),
      output: args.output,
      artifacts: args.artifacts || [],
      metadata: args.metadata,
      producedAt: new Date().toISOString(),
    },
  };
}

type TaskWorkbenchHistoryRecord = {
  id: string;
  taskTemplateId: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  artifactCount: number;
  artifacts: AgentArtifact[];
  metadata?: Record<string, unknown>;
};

function taskWorkbenchIndexRel() {
  return "office/task-workbench/index.json";
}

function safeWorkspaceRel(user: LabUser, relPath: unknown) {
  if (!user.workspace) return null;
  const rel = sanitizeRelPath(String(relPath || ""));
  if (!rel || rel.includes("..")) return null;
  const abs = path.normalize(path.join(user.workspace, rel));
  if (!abs.startsWith(user.workspace + path.sep) && abs !== user.workspace)
    return null;
  return { rel, abs };
}

function readTaskWorkbenchIndex(user: LabUser): TaskWorkbenchHistoryRecord[] {
  const safe = safeWorkspaceRel(user, taskWorkbenchIndexRel());
  if (!safe || !existsSync(safe.abs)) return [];
  try {
    const parsed = JSON.parse(readFileSync(safe.abs, "utf8"));
    return Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeTaskWorkbenchIndex(
  user: LabUser,
  records: TaskWorkbenchHistoryRecord[]
) {
  const safe = safeWorkspaceRel(user, taskWorkbenchIndexRel());
  if (!safe) return;
  mkdirSync(path.dirname(safe.abs), { recursive: true });
  writeFileSync(
    safe.abs,
    JSON.stringify({ version: 1, records: records.slice(0, 100) }, null, 2),
    "utf8"
  );
}

function makeTaskTitle(prompt: string, fallback: string) {
  const text = String(prompt || "")
    .replace(/\s+/g, " ")
    .trim();
  return (text ? text.slice(0, 32) : fallback) || "办公任务";
}

function persistTaskWorkbenchHistory(input: {
  user: LabUser;
  taskRun: TaskRunResult;
  prompt: string;
  inputOptions?: Record<string, unknown>;
}) {
  const outputRoot = String(input.taskRun.metadata?.workspaceOutputRoot || "");
  const rootRel = outputRoot.replace(/\/outputs\/?$/g, "");
  const runSafe = safeWorkspaceRel(input.user, `${rootRel}/task-run.json`);
  if (!runSafe) return;
  mkdirSync(path.dirname(runSafe.abs), { recursive: true });
  const taskRun = {
    ...input.taskRun,
    metadata: {
      ...(input.taskRun.metadata || {}),
      inputOptions: input.inputOptions || {},
    },
  };
  writeFileSync(runSafe.abs, JSON.stringify(taskRun, null, 2), "utf8");

  const now =
    input.taskRun.completedAt ||
    input.taskRun.startedAt ||
    new Date().toISOString();
  const record: TaskWorkbenchHistoryRecord = {
    id: input.taskRun.taskRunId,
    taskTemplateId: input.taskRun.taskTemplateId,
    title: makeTaskTitle(input.prompt, input.taskRun.taskTemplateId),
    prompt: input.prompt,
    status: input.taskRun.status,
    createdAt: input.taskRun.startedAt || now,
    updatedAt: now,
    artifactCount: input.taskRun.artifacts?.length || 0,
    artifacts: input.taskRun.artifacts || [],
    metadata: {
      ...(input.taskRun.metadata || {}),
      taskRunPath: runSafe.rel,
      inputOptions: input.inputOptions || {},
    },
  };
  const records = readTaskWorkbenchIndex(input.user).filter(
    item => item.id !== record.id
  );
  writeTaskWorkbenchIndex(input.user, [record, ...records]);
}

function readTaskWorkbenchRun(user: LabUser, taskRunId: string) {
  const safeId = String(taskRunId || "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 96);
  if (!safeId) return null;
  const safe = safeWorkspaceRel(
    user,
    `${taskWorkbenchRelRoot(safeId)}/task-run.json`
  );
  if (!safe || !existsSync(safe.abs)) return null;
  try {
    return JSON.parse(readFileSync(safe.abs, "utf8")) as TaskRunResult;
  } catch {
    return null;
  }
}

function resolveResearchPptOptions(
  user: LabUser,
  inputOptions?: Record<string, unknown>
) {
  const options = inputOptions || {};
  const contextPaths = Array.isArray(options.contextPaths)
    ? (options.contextPaths
        .map(item => safeWorkspaceRel(user, item)?.rel)
        .filter(Boolean) as string[])
    : [];
  const rawSlideRange = String(options.slideRange || "8-12").trim();
  const slideRange = ["4-8", "8-12", "12-16"].includes(rawSlideRange)
    ? rawSlideRange
    : "8-12";
  const selectedTemplateId = String(options.templateId || "huawei-light");
  const builtins = getBuiltinPptTemplates();
  const builtin =
    builtins.find(item => item.id === selectedTemplateId && item.available) ||
    builtins.find(item => item.id === "huawei-light");
  if (selectedTemplateId === "custom") {
    const custom = safeWorkspaceRel(user, options.templatePath);
    if (custom && existsSync(custom.abs)) {
      return {
        templateId: "custom",
        templateName: String(
          options.templateName || path.basename(custom.rel) || "自定义模板"
        ),
        templatePath: custom.rel,
        templateAbs: custom.abs,
        slideRange,
        contextPaths,
      };
    }
  }
  return {
    templateId: builtin?.id || "huawei-light",
    templateName: builtin?.name || "Huawei 浅色模板",
    templatePath: builtin
      ? path.relative(APP_ROOT, builtin.absPath).replace(/\\/g, "/")
      : "data/office-templates/huawei-light.pptx",
    templateAbs: builtin?.absPath,
    slideRange,
    contextPaths,
  };
}

function extractVideoUrl(
  inputOptions: Record<string, unknown> | undefined,
  prompt: string
) {
  const raw =
    String(inputOptions?.videoUrl || "").trim() ||
    String(prompt || "").match(
      /https?:\/\/[^\s，。；;]+|www\.[^\s，。；;]+/i
    )?.[0] ||
    "";
  const normalized = raw.startsWith("www.") ? `https://${raw}` : raw;
  if (!normalized || normalized.length > 2000) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildVideoOutlineTaskPrompt(input: {
  prompt: string;
  videoUrl: string;
  outputRel: string;
}) {
  return [
    "你是企业学习与研究助手。请根据用户提供的视频链接，生成可归档、可复用的视频提纲。",
    "",
    "处理原则：",
    "1. 优先尝试读取视频页面、公开字幕、transcript、简介、章节、评论摘要或可搜索到的公开资料。",
    "2. 如果能拿到 transcript，请以 transcript 为主；如果只能拿到页面信息或搜索结果，请明确标注“未获取完整转写”。",
    "3. 不要声称你已经观看了视频画面；除非确实有逐字稿或页面资料，否则只能基于可获得文本分析。",
    "4. 对登录后可见、付费课程、无字幕或无法访问的链接，要说明限制，并给出用户可上传音频/视频后的处理建议。",
    "5. 不要编造讲者观点、时间戳或课程内容；不确定的内容放到“待确认”。",
    "",
    "视频链接：",
    input.videoUrl,
    "",
    "用户要求：",
    input.prompt,
    "",
    "请输出中文 Markdown，固定包含以下章节：",
    "# 视频提纲",
    "## 基本信息",
    "列出标题、来源平台、链接、讲者/频道、时长、发布时间；未知则写未知。",
    "## 内容可得性",
    "说明是否获取到完整转写、字幕、页面正文或仅能获取公开摘要。",
    "## 三句话摘要",
    "## 详细提纲",
    "按主题或章节组织；有可靠时间戳时再写时间戳。",
    "## 关键观点",
    "## 可执行启发",
    "## 适合写进报告或 PPT 的要点",
    "## 待确认与局限",
    "",
    `同时请把同样内容写入工作空间文件：${input.outputRel}`,
  ].join("\n");
}

async function runVideoOutlineTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  inputOptions?: Record<string, unknown>;
  onStageStarted?: (stageId: string) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
}): Promise<TaskRunResult> {
  if (!input.user.adoptId || !input.user.claw || !input.user.workspace)
    throw new Error("video_outline_user_context_missing");
  const videoUrl = extractVideoUrl(input.inputOptions, input.prompt);
  if (!videoUrl) throw new Error("请输入有效的视频链接");

  const startedAt = new Date().toISOString();
  const taskRunId = `video-outline-${Date.now()}`;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRunId)}/outputs`;
  const outputAbsRoot = path.join(input.user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  const requestRel = `${outputRelRoot}/video-request.md`;
  const outlineRel = `${outputRelRoot}/video-outline.md`;
  const docxRel = `${outputRelRoot}/video-outline.docx`;
  const previewRel = `${outputRelRoot}/video-outline-preview.html`;
  const requestMarkdown = [
    "# 视频提纲任务",
    "",
    `- 时间：${startedAt}`,
    `- 视频链接：${videoUrl}`,
    "",
    "## 用户要求",
    "",
    input.prompt,
  ].join("\n");
  writeFileSync(
    path.join(input.user.workspace, requestRel),
    requestMarkdown,
    "utf8"
  );

  input.onStageStarted?.("video_source_reader");
  const sourceStageOutput = [
    "# 视频资料读取",
    "",
    `- 视频链接：${videoUrl}`,
    "- 已启动公开视频页面、字幕、简介、章节和公开搜索资料读取。",
    "- 如链接需要登录、无字幕或无法访问，将在最终提纲中标注内容可得性和待确认项。",
  ].join("\n");
  const sourceStage = makeResearchPptStage({
    stageId: "video_source_reader",
    personaId: "reader",
    agentDefinitionId: "video-outline-reader",
    output: sourceStageOutput,
    artifacts: [
      workspaceArtifact({
        user: input.user,
        rel: requestRel,
        type: "markdown",
        mimeType: "text/markdown; charset=utf-8",
      }),
    ],
    metadata: {
      role: "Reader",
      stageTitle: "检索员读取视频链接与可用文字资料",
      videoUrl,
      runtime: "openclaw",
    },
  });
  input.onStageDone?.(sourceStage);

  input.onStageStarted?.("outline_writer");
  const outline = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    timeoutMs: input.template.maxDurationMs || 600_000,
    prompt: buildVideoOutlineTaskPrompt({
      prompt: input.prompt,
      videoUrl,
      outputRel: outlineRel,
    }),
  });
  writeFileSync(
    path.join(input.user.workspace, outlineRel),
    `${outline}\n`,
    "utf8"
  );
  const docxBuffer = await markdownToDocxBuffer({
    title: "视频提纲",
    markdown: outline,
    disclaimer:
      "本提纲由 AI 助手基于可访问的公开文字资料生成，视频内容、时间戳与事实信息需人工复核。",
  });
  writeFileSync(path.join(input.user.workspace, docxRel), docxBuffer);
  writeFileSync(
    path.join(input.user.workspace, previewRel),
    buildWordCompatibleHtml("视频提纲", outline),
    "utf8"
  );

  const writerArtifacts = [
    {
      id: `workspace:${docxRel}`,
      type: "file",
      name: path.basename(docxRel),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      previewUrl: workspaceDownloadUrl(input.user.adoptId || "", previewRel),
      downloadUrl: workspaceDownloadUrl(input.user.adoptId || "", docxRel),
      metadata: {
        source: "task-workbench-workspace",
        workspacePath: docxRel,
        previewWorkspacePath: previewRel,
        size: statSync(path.join(input.user.workspace, docxRel)).size,
      },
    } as AgentArtifact,
    workspaceArtifact({
      user: input.user,
      rel: outlineRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const writerStage = makeResearchPptStage({
    stageId: "outline_writer",
    personaId: "writer",
    agentDefinitionId: "video-outline-writer",
    output: outline,
    artifacts: writerArtifacts,
    metadata: {
      role: "Writer",
      stageTitle: "写作员生成视频提纲",
      runtime: "openclaw",
      artifactType: "docx",
      videoUrl,
    },
  });
  input.onStageDone?.(writerStage);

  const stages = [sourceStage, writerStage];
  const artifacts = [...writerArtifacts];
  const taskRun: TaskRunResult = {
    taskRunId,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `video-outline:${input.template.version}`,
    status: "completed",
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: "docx",
      runtime: "openclaw",
      videoUrl,
      workspaceOutputRoot: outputRelRoot,
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `video-outline:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistTaskWorkbenchHistory({
    user: input.user,
    taskRun,
    prompt: input.prompt,
    inputOptions: input.inputOptions,
  });
  return taskRun;
}

function resolveMeetingInput(
  user: LabUser,
  inputOptions: Record<string, unknown> | undefined
) {
  const contextPaths = Array.isArray(inputOptions?.contextPaths)
    ? (inputOptions?.contextPaths as unknown[])
    : [];
  for (const item of contextPaths) {
    const safe = safeWorkspaceRel(user, item);
    if (!safe || !existsSync(safe.abs)) continue;
    const ext = path.extname(safe.rel).toLowerCase();
    if (
      [".mp3", ".wav", ".m4a", ".aac", ".webm", ".ogg", ".mp4"].includes(ext)
    ) {
      return { kind: "audio" as const, ...safe };
    }
    if ([".txt", ".md", ".markdown"].includes(ext)) {
      return { kind: "text" as const, ...safe };
    }
  }
  return null;
}

function stripMarkdownHeading(markdown: string) {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

async function runMeetingNotesTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  inputOptions?: Record<string, unknown>;
  onStageStarted?: (stageId: string) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
}): Promise<TaskRunResult> {
  if (!input.user.adoptId || !input.user.claw || !input.user.workspace)
    throw new Error("meeting_notes_user_context_missing");

  const startedAt = new Date().toISOString();
  const taskRunId = `meeting-notes-${Date.now()}`;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRunId)}/outputs`;
  const outputAbsRoot = path.join(input.user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  const meetingInput = resolveMeetingInput(input.user, input.inputOptions);
  const transcriptRel = `${outputRelRoot}/meeting-transcript.md`;
  const summaryRel = `${outputRelRoot}/meeting-notes.md`;
  const docxRel = `${outputRelRoot}/meeting-notes.docx`;
  const previewRel = `${outputRelRoot}/meeting-notes-preview.html`;
  const pcmRel = `${outputRelRoot}/meeting-audio.pcm`;
  const pcmAbs = path.join(input.user.workspace, pcmRel);

  input.onStageStarted?.("audio_transcriber");
  let transcript = "";
  let sourceSummary = "";
  let asrTaskId: string | undefined;
  if (meetingInput?.kind === "audio") {
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          meetingInput.abs,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "s16le",
          pcmAbs,
        ],
        { timeout: 180_000 }
      );
    } catch {
      throw new Error("音频格式转换失败，请确认录音文件可被 ffmpeg 解析");
    }
    const pcmBytes = statSync(pcmAbs).size;
    const durationSec = Math.round(pcmBytes / (16000 * 2));
    if (durationSec < 5)
      throw new Error("录音太短或没有有效语音，请至少上传 5 秒以上的录音。");
    const result = await transcribeWithXfyunOst(pcmAbs, taskRunId, durationSec);
    transcript = result.transcript;
    asrTaskId = result.taskId;
    sourceSummary = [
      "# 会议转写",
      "",
      `- 输入文件：${meetingInput.rel}`,
      `- 识别时长：${durationSec} 秒`,
      `- 讯飞任务：${asrTaskId}`,
      "",
      "## 原始转写",
      "",
      transcript,
    ].join("\n");
  } else if (meetingInput?.kind === "text") {
    transcript = readFileSync(meetingInput.abs, "utf8").trim();
    sourceSummary = [
      "# 会议转写",
      "",
      `- 输入文件：${meetingInput.rel}`,
      "- 输入类型：文本材料",
      "",
      "## 原始转写",
      "",
      transcript,
    ].join("\n");
  } else if (input.prompt.trim().length >= 40) {
    transcript = input.prompt.trim();
    sourceSummary = [
      "# 会议转写",
      "",
      "- 输入类型：用户直接输入",
      "",
      "## 原始转写",
      "",
      transcript,
    ].join("\n");
  } else {
    throw new Error("请先上传会议录音，或粘贴较完整的会议转写文本。");
  }

  writeFileSync(
    path.join(input.user.workspace, transcriptRel),
    `${sourceSummary}\n`,
    "utf8"
  );
  const transcriptStage = makeResearchPptStage({
    stageId: "audio_transcriber",
    personaId: "reader",
    agentDefinitionId: "meeting-audio-transcriber",
    output: sourceSummary,
    artifacts: [
      workspaceArtifact({
        user: input.user,
        rel: transcriptRel,
        type: "markdown",
        mimeType: "text/markdown; charset=utf-8",
      }),
    ],
    metadata: {
      role: "Reader",
      stageTitle: "转写员读取录音或会议文本",
      runtime: meetingInput?.kind === "audio" ? "xfyun-ost" : "user-text",
      asrTaskId,
    },
  });
  input.onStageDone?.(transcriptStage);

  input.onStageStarted?.("notes_writer");
  const runtimeAgentId = resolveRuntimeAgentId(
    input.user.adoptId,
    String(input.user.claw?.agentId || "")
  );
  const summary = await summarizeMeetingWithOpenClaw({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    runtimeAgentId,
    meetingId: taskRunId,
    meetingType: "general",
    transcript,
  });
  const summaryBody = stripMarkdownHeading(summary);
  const summaryMarkdown = [
    "# 会议纪要",
    "",
    `- 时间：${startedAt}`,
    meetingInput
      ? `- 输入材料：${meetingInput.rel}`
      : "- 输入材料：用户直接输入",
    asrTaskId ? `- 讯飞任务：${asrTaskId}` : "",
    "",
    summaryBody,
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(
    path.join(input.user.workspace, summaryRel),
    `${summaryMarkdown}\n`,
    "utf8"
  );
  const docxBuffer = await markdownToDocxBuffer({
    title: "会议纪要",
    markdown: summaryMarkdown,
    disclaimer:
      "本纪要由 AI 助手基于会议录音转写或用户提供文本生成，关键决策、负责人和截止时间需人工复核。",
  });
  writeFileSync(path.join(input.user.workspace, docxRel), docxBuffer);
  writeFileSync(
    path.join(input.user.workspace, previewRel),
    buildWordCompatibleHtml("会议纪要", summaryMarkdown),
    "utf8"
  );

  const notesArtifacts = [
    {
      id: `workspace:${docxRel}`,
      type: "file",
      name: path.basename(docxRel),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      previewUrl: workspaceDownloadUrl(input.user.adoptId || "", previewRel),
      downloadUrl: workspaceDownloadUrl(input.user.adoptId || "", docxRel),
      metadata: {
        source: "task-workbench-workspace",
        workspacePath: docxRel,
        previewWorkspacePath: previewRel,
        size: statSync(path.join(input.user.workspace, docxRel)).size,
      },
    } as AgentArtifact,
    workspaceArtifact({
      user: input.user,
      rel: summaryRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const notesStage = makeResearchPptStage({
    stageId: "notes_writer",
    personaId: "writer",
    agentDefinitionId: "meeting-notes-writer",
    output: summaryMarkdown,
    artifacts: notesArtifacts,
    metadata: {
      role: "Writer",
      stageTitle: "写作员生成会议纪要",
      runtime: "openclaw",
      artifactType: "docx",
    },
  });
  input.onStageDone?.(notesStage);

  const stages = [transcriptStage, notesStage];
  const artifacts = [
    ...notesArtifacts,
    workspaceArtifact({
      user: input.user,
      rel: transcriptRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const taskRun: TaskRunResult = {
    taskRunId,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `meeting-notes:${input.template.version}`,
    status: "completed",
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: "docx",
      runtime:
        meetingInput?.kind === "audio" ? "xfyun-ost+openclaw" : "openclaw",
      asrTaskId,
      workspaceOutputRoot: outputRelRoot,
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `meeting-notes:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistTaskWorkbenchHistory({
    user: input.user,
    taskRun,
    prompt: input.prompt,
    inputOptions: input.inputOptions,
  });
  return taskRun;
}

function resolveExcelFillInputs(
  user: LabUser,
  inputOptions: Record<string, unknown> | undefined
) {
  const contextPaths = Array.isArray(inputOptions?.contextPaths)
    ? (inputOptions?.contextPaths as unknown[])
    : [];
  let workbook: { rel: string; abs: string } | null = null;
  const contexts: string[] = [];
  for (const item of contextPaths) {
    const safe = safeWorkspaceRel(user, item);
    if (!safe || !existsSync(safe.abs)) continue;
    if (!workbook && /\.(xlsx|xls)$/i.test(safe.rel)) {
      workbook = safe;
    } else {
      contexts.push(safe.rel);
    }
  }
  return { workbook, contexts };
}

function buildExcelFillPlanPrompt(input: {
  workbookPath: string;
  contextPaths: string[];
  instruction: string;
  planPath: string;
}) {
  return [
    "你是企业办公 Excel 填表助手。请先生成“填表方案预览”，不要修改原始 Excel 文件。",
    "",
    "工作方式：",
    "1. 读取工作空间里的 Excel 和背景资料，必要时可使用 Python、系统命令或可用工具查看文件内容。",
    "2. 不要联网安装依赖；如果当前环境无法解析某类文件，请在方案里说明限制。",
    "3. 只基于用户提供的资料推断填写内容，不要编造事实。",
    "4. 已有内容默认不覆盖；除非用户明确要求覆盖。",
    "5. 低置信度、资料不足、字段歧义的地方必须标记为“需人工确认”。",
    "",
    "输入文件：",
    `- Excel：${input.workbookPath}`,
    ...input.contextPaths.map(item => `- 背景资料：${item}`),
    "",
    "用户填写要求：",
    input.instruction || "根据背景资料补全 Excel 空白字段，不覆盖已有内容。",
    "",
    "请输出 Markdown，固定包含以下章节：",
    "# Excel 填表方案",
    "## 任务理解",
    "## 表格结构识别",
    "## 建议填写清单",
    "用表格列出：Sheet、单元格/字段、当前值、建议填写、依据来源、置信度、是否需人工确认。",
    "## 无法判断或需确认",
    "## 写回规则",
    "",
    `同时请把同样内容写入工作空间文件：${input.planPath}`,
  ].join("\n");
}

function buildExcelFillApplyPrompt(input: {
  workbookPath: string;
  contextPaths: string[];
  instruction: string;
  plan: string;
  resultPath: string;
  resultNotePath: string;
}) {
  return [
    "你是企业办公 Excel 填表执行助手。请根据已确认的填表方案，生成一个新的 Excel 副本。",
    "",
    "安全规则：",
    "1. 绝对不要覆盖原始 Excel 文件。",
    `2. 只允许把结果写入：${input.resultPath}`,
    `3. 处理说明写入：${input.resultNotePath}`,
    "4. 默认只填写空白单元格，不覆盖已有内容；用户要求覆盖时才覆盖。",
    "5. 对“需人工确认”或置信度低的内容，不要强行写入，可保留为空并写入处理说明。",
    "6. 尽量保留原工作簿格式、sheet、公式和样式。",
    "",
    "输入文件：",
    `- Excel：${input.workbookPath}`,
    ...input.contextPaths.map(item => `- 背景资料：${item}`),
    "",
    "用户填写要求：",
    input.instruction || "根据背景资料补全 Excel 空白字段，不覆盖已有内容。",
    "",
    "已确认的填表方案：",
    input.plan.slice(0, 50000),
    "",
    "输出要求：",
    "1. 如果成功生成 Excel，请简要说明填写了哪些字段、跳过了哪些字段。",
    "2. 如果无法生成 Excel，请说明具体缺少什么能力，并把可复制的填写清单写入处理说明文件。",
  ].join("\n");
}

async function runExcelFillTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  inputOptions?: Record<string, unknown>;
  onStageStarted?: (stageId: string) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
}): Promise<TaskRunResult> {
  if (!input.user.adoptId || !input.user.claw || !input.user.workspace)
    throw new Error("excel_fill_user_context_missing");
  const { workbook, contexts } = resolveExcelFillInputs(
    input.user,
    input.inputOptions
  );
  if (!workbook) throw new Error("请先上传需要填写的 Excel 文件");

  const startedAt = new Date().toISOString();
  const taskRunId = `excel-fill-${Date.now()}`;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRunId)}/outputs`;
  const outputAbsRoot = path.join(input.user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  const planRel = `${outputRelRoot}/fill-plan.md`;
  const resultRel = `${outputRelRoot}/filled.xlsx`;
  const resultNoteRel = `${outputRelRoot}/fill-result.md`;
  const previewRel = `${outputRelRoot}/fill-result-preview.html`;

  input.onStageStarted?.("excel_planner");
  const plan = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    timeoutMs: 300_000,
    prompt: buildExcelFillPlanPrompt({
      workbookPath: workbook.rel,
      contextPaths: contexts,
      instruction: input.prompt,
      planPath: planRel,
    }),
  });
  writeFileSync(path.join(input.user.workspace, planRel), `${plan}\n`, "utf8");
  const plannerStage = makeResearchPptStage({
    stageId: "excel_planner",
    personaId: "analyst",
    agentDefinitionId: "excel-fill-planner",
    output: plan,
    artifacts: [
      workspaceArtifact({
        user: input.user,
        rel: planRel,
        type: "markdown",
        mimeType: "text/markdown; charset=utf-8",
      }),
    ],
    metadata: {
      role: "Analyst",
      stageTitle: "分析员生成填表方案",
      runtime: "openclaw",
      workbookPath: workbook.rel,
      contextPaths: contexts,
    },
  });
  input.onStageDone?.(plannerStage);

  input.onStageStarted?.("excel_writer");
  const resultSummary = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    timeoutMs: input.template.maxDurationMs || 600_000,
    prompt: buildExcelFillApplyPrompt({
      workbookPath: workbook.rel,
      contextPaths: contexts,
      instruction: input.prompt,
      plan,
      resultPath: resultRel,
      resultNotePath: resultNoteRel,
    }),
  });
  const resultAbs = path.join(input.user.workspace, resultRel);
  writeFileSync(
    path.join(input.user.workspace, resultNoteRel),
    `${resultSummary}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(input.user.workspace, previewRel),
    buildWordCompatibleHtml("Excel 填表说明", resultSummary),
    "utf8"
  );
  const writerArtifacts: AgentArtifact[] = [
    workspaceArtifact({
      user: input.user,
      rel: resultNoteRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  if (existsSync(resultAbs)) {
    writerArtifacts.unshift(
      workspaceArtifact({
        user: input.user,
        rel: resultRel,
        type: "xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
  }
  const noteArtifact = writerArtifacts.find(
    item => item.name === path.basename(resultNoteRel)
  );
  if (noteArtifact)
    noteArtifact.previewUrl = workspaceDownloadUrl(
      input.user.adoptId || "",
      previewRel
    );
  const writerStage = makeResearchPptStage({
    stageId: "excel_writer",
    personaId: "writer",
    agentDefinitionId: "excel-fill-writer",
    output: resultSummary,
    artifacts: writerArtifacts,
    metadata: {
      role: "Writer",
      stageTitle: "执行员写回 Excel 副本",
      runtime: "openclaw",
      artifactType: existsSync(resultAbs) ? "xlsx" : "markdown",
      workbookPath: workbook.rel,
    },
  });
  input.onStageDone?.(writerStage);

  const stages = [plannerStage, writerStage];
  const artifacts = [
    ...writerArtifacts,
    workspaceArtifact({
      user: input.user,
      rel: planRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const taskRun: TaskRunResult = {
    taskRunId,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `excel-fill:${input.template.version}`,
    status: existsSync(resultAbs) ? "completed" : "partial_success",
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: existsSync(resultAbs) ? "xlsx" : "markdown",
      runtime: "openclaw",
      workbookPath: workbook.rel,
      contextPaths: contexts,
      workspaceOutputRoot: outputRelRoot,
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `excel-fill:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistTaskWorkbenchHistory({
    user: input.user,
    taskRun,
    prompt: input.prompt,
    inputOptions: input.inputOptions,
  });
  return taskRun;
}

async function runResearchPptTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  inputOptions?: Record<string, unknown>;
  onStageStarted?: (stageId: string) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
}): Promise<TaskRunResult> {
  if (!input.user.adoptId || !input.user.claw || !input.user.workspace)
    throw new Error("research_ppt_user_context_missing");
  const startedAt = new Date().toISOString();
  const taskRunId = `research-ppt-${Date.now()}`;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRunId)}/outputs`;
  const outputAbsRoot = path.join(input.user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  const pptOptions = resolveResearchPptOptions(input.user, input.inputOptions);
  const promptWithContext = [
    input.prompt,
    `\n\n期望页数：${pptOptions.slideRange} 页。PPT_BLUEPRINT_JSON 的 slides 数量应落在该范围内；如果用户原始要求有更明确页数，以用户原始要求优先。`,
    pptOptions.contextPaths.length
      ? "\n\n输入材料路径：\n" +
        pptOptions.contextPaths.map(item => `- ${item}`).join("\n")
      : "",
  ].join("");

  const outlineResult =
    (await tryRunResearchPptHermesOutline({
      ...input,
      prompt: promptWithContext,
      taskRunId,
      onStageStarted: input.onStageStarted,
      onStageDone: input.onStageDone,
      onProviderEvent: input.onProviderEvent,
    })) ||
    (await runResearchPptOpenClawOutline({
      ...input,
      prompt: promptWithContext,
    }));
  const outline = outlineResult.outline;
  const blueprint = resolveBlueprint(
    outline,
    input.prompt.slice(0, 60) || "研究型 PPT"
  );

  const outlineRel = `${outputRelRoot}/outline.md`;
  const blueprintRel = `${outputRelRoot}/blueprint.json`;
  const previewRel = `${outputRelRoot}/slides-preview.html`;
  const pptxRel = `${outputRelRoot}/slides.pptx`;
  const editableRel = `${outputRelRoot}/slides-editable.pptx`;
  const imageDirAbs = path.join(outputAbsRoot, "slide-images");
  const qualityJsonRel = `${outputRelRoot}/quality-report.json`;
  const qualityMdRel = `${outputRelRoot}/quality-report.md`;
  const templatePath = pptOptions.templatePath;
  const templateAbs = pptOptions.templateAbs;
  const templateName = pptOptions.templateName;

  writeFileSync(path.join(input.user.workspace, outlineRel), outline, "utf8");
  writeFileSync(
    path.join(input.user.workspace, blueprintRel),
    JSON.stringify(blueprint, null, 2),
    "utf8"
  );
  const outlineArtifacts = [
    workspaceArtifact({
      user: input.user,
      rel: outlineRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
    workspaceArtifact({
      user: input.user,
      rel: blueprintRel,
      type: "code",
      mimeType: "application/json; charset=utf-8",
      language: "json",
    }),
  ];
  const outlineWriterStage = makeResearchPptStage({
    stageId: "outline_writer",
    personaId: "writer",
    agentDefinitionId: "ppt-outline-writer",
    output: outlineResult.outlineOutput,
    artifacts: outlineArtifacts,
    metadata: {
      role: "Writer",
      profile: "ppt-outline-writer",
      runtime: outlineResult.runtime,
      runId: outlineResult.stageRunIds?.outline_writer,
      artifactType: "pptx",
    },
  });
  input.onStageDone?.(outlineWriterStage);

  input.onStageStarted?.("template_renderer");
  writeFileSync(
    path.join(input.user.workspace, previewRel),
    renderDeckHtml({
      blueprint,
      templateName,
      generatedAt: new Date().toISOString(),
    }),
    "utf8"
  );

  await generatePptxFromBlueprint({
    blueprint,
    outputAbs: path.join(input.user.workspace, editableRel),
    templateName,
    templatePath,
    instruction: input.prompt,
  });
  await generateImagePptxFromBlueprint({
    blueprint,
    outputAbs: path.join(input.user.workspace, pptxRel),
    imageDirAbs,
    templateName,
    templateAbs:
      templateAbs && existsSync(templateAbs) ? templateAbs : undefined,
  });
  const rendererArtifacts = [
    workspaceArtifact({
      user: input.user,
      rel: previewRel,
      type: "html",
      mimeType: "text/html; charset=utf-8",
      preview: true,
    }),
    workspaceArtifact({
      user: input.user,
      rel: pptxRel,
      type: "pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
    workspaceArtifact({
      user: input.user,
      rel: editableRel,
      type: "pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
  ];
  const rendererStage = makeResearchPptStage({
    stageId: "template_renderer",
    personaId: "renderer",
    agentDefinitionId: "ppt-template-renderer",
    output: `已基于 ${templateName} 渲染 ${blueprint.slides.length} 页 PPT，并生成 HTML 预览、PPTX 和可编辑版本。`,
    artifacts: rendererArtifacts,
    metadata: {
      role: "Renderer",
      profile: "ppt-template-renderer",
      runtime: "employee-agent",
      artifactType: "pptx",
    },
  });
  input.onStageDone?.(rendererStage);

  input.onStageStarted?.("quality_checker");
  const qualityReport = buildQualityReport({
    blueprint,
    pptxPath: path.join(input.user.workspace, editableRel),
  });
  writeFileSync(
    path.join(input.user.workspace, qualityJsonRel),
    JSON.stringify(qualityReport, null, 2),
    "utf8"
  );
  const qualityMarkdown = [
    "# PPT 质量校验",
    "",
    `- 校验结果：${qualityReport.ok ? "通过" : "需关注"}`,
    `- 期望页数：${qualityReport.expectedSlideCount}`,
    `- 实际页数：${qualityReport.slideCount}`,
    "",
    "## 发现项",
    ...(qualityReport.findings.length
      ? qualityReport.findings.map(
          item =>
            `- ${item.severity}${item.pageNo ? ` P${item.pageNo}` : ""}：${item.message}`
        )
      : ["- 未发现阻断性问题。"]),
    "",
  ].join("\n");
  writeFileSync(
    path.join(input.user.workspace, qualityMdRel),
    qualityMarkdown,
    "utf8"
  );
  const qualityArtifacts = [
    workspaceArtifact({
      user: input.user,
      rel: qualityMdRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const checkerStage = makeResearchPptStage({
    stageId: "quality_checker",
    personaId: "checker",
    agentDefinitionId: "ppt-quality-checker",
    status: qualityReport.ok ? "success" : "failed",
    output: qualityMarkdown,
    artifacts: qualityArtifacts,
    metadata: {
      role: "Checker",
      profile: "ppt-quality-checker",
      runtime: "employee-agent",
      qualityReport,
      artifactType: "pptx",
    },
  });
  input.onStageDone?.(checkerStage);

  const artifacts = [
    ...rendererArtifacts,
    ...outlineArtifacts,
    ...qualityArtifacts,
  ];

  const outlineStages = outlineResult.stages?.length
    ? outlineResult.stages
    : [
        makeResearchPptStage({
          stageId: "source_reader",
          personaId: "reader",
          agentDefinitionId: "ppt-source-reader",
          output: outlineResult.sourceOutput,
          metadata: {
            role: "Reader",
            profile: "ppt-source-reader",
            runtime: outlineResult.runtime,
            runId: outlineResult.stageRunIds?.source_reader,
          },
        }),
        makeResearchPptStage({
          stageId: "insight_analyst",
          personaId: "analyst",
          agentDefinitionId: "ppt-insight-analyst",
          output: outlineResult.analysisOutput,
          metadata: {
            role: "Analyst",
            profile: "ppt-insight-analyst",
            runtime: outlineResult.runtime,
            runId: outlineResult.stageRunIds?.insight_analyst,
          },
        }),
      ];
  const stages: TaskRunResult["stages"] = [
    ...outlineStages,
    outlineWriterStage,
    rendererStage,
    checkerStage,
  ];

  const taskRun: TaskRunResult = {
    taskRunId,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `research-ppt:${input.template.version}`,
    status: qualityReport.ok ? "completed" : "partial_success",
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: "pptx",
      runtime: `${outlineResult.runtime}+employee-agent`,
      workspaceOutputRoot: outputRelRoot,
      templateName,
      templateId: pptOptions.templateId,
      templatePath,
      slideRange: pptOptions.slideRange,
      contextPaths: pptOptions.contextPaths,
      outlineRuntime: outlineResult.runtime,
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `research-ppt:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistTaskWorkbenchHistory({
    user: input.user,
    taskRun,
    prompt: input.prompt,
    inputOptions: {
      ...(input.inputOptions || {}),
      templateId: pptOptions.templateId,
      templateName,
      templatePath,
      slideRange: pptOptions.slideRange,
      contextPaths: pptOptions.contextPaths,
    },
  });
  return taskRun;
}

function resolveWindMcpSkillDir() {
  const candidates = [
    process.env.WIND_MCP_SKILL_DIR,
    path.join(APP_ROOT, ".agents", "skills", "wind-mcp-skill"),
    path.join(process.env.HOME || "", ".agents", "skills", "wind-mcp-skill"),
  ].filter(Boolean) as string[];
  return (
    candidates.find(item =>
      existsSync(path.join(item, "scripts", "cli.mjs"))
    ) || null
  );
}

function decodeJsonStringField(value: string) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function extractWindContentFieldsFromText(text: string) {
  const chunks: string[] = [];
  const patterns = [
    /"content"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /\\"content\\"\s*:\s*\\"((?:\\\\.|[^\\"\\\\])*)\\"/g,
  ];
  for (const contentPattern of patterns) {
    for (const match of text.matchAll(contentPattern)) {
      const decoded = decodeJsonStringField(match[1] || "").trim();
      if (decoded) chunks.push(decoded);
    }
  }
  const titlePattern = /\\"title\\"\s*:\s*\\"((?:\\\\.|[^\\"\\\\])*)\\"/g;
  for (const match of text.matchAll(titlePattern)) {
    const decoded = decodeJsonStringField(match[1] || "").trim();
    if (decoded) chunks.unshift(`标题：${decoded}`);
  }
  return chunks.join("\n\n");
}

function windPayloadToText(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") {
    const text = payload.trim();
    if (/^[\[{]/.test(text)) {
      try {
        return windPayloadToText(JSON.parse(text));
      } catch {
        const opener = text[0];
        const closer = opener === "{" ? "}" : "]";
        const lastJsonCharIndex = text.lastIndexOf(closer);
        if (lastJsonCharIndex > 0) {
          try {
            return windPayloadToText(
              JSON.parse(text.slice(0, lastJsonCharIndex + 1))
            );
          } catch {
            return extractWindContentFieldsFromText(text) || text;
          }
        }
        return extractWindContentFieldsFromText(text) || text;
      }
    }
    return extractWindContentFieldsFromText(text) || text;
  }
  if (Array.isArray(payload)) {
    return payload.map(windPayloadToText).filter(Boolean).join("\n\n");
  }
  if (typeof payload !== "object") return String(payload);
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.items)) return windPayloadToText(record.items);
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const source =
    typeof record.source === "string"
      ? record.source.trim()
      : typeof record.provider === "string"
        ? record.provider.trim()
        : "";
  const date =
    typeof record.date === "string"
      ? record.date.trim()
      : typeof record.publishTime === "string"
        ? record.publishTime.trim()
        : typeof record.time === "string"
          ? record.time.trim()
          : "";
  const url =
    typeof record.url === "string"
      ? record.url.trim()
      : typeof record.link === "string"
        ? record.link.trim()
        : "";
  const content =
    typeof record.content === "string"
      ? record.content.trim()
      : typeof record.summary === "string"
        ? record.summary.trim()
        : typeof record.text === "string"
          ? record.text.trim()
          : "";
  if (title || source || date || url || content) {
    return [
      title ? `标题：${title}` : "",
      source || date ? `来源：${[source, date].filter(Boolean).join(" · ")}` : "",
      url ? `URL：${url}` : "",
      content,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.content === "string") return record.content.trim();
  if (Array.isArray(record.content)) return windPayloadToText(record.content);
  if (record.result) return windPayloadToText(record.result);
  if (record.data) return windPayloadToText(record.data);
  const extractedContent = extractWindContentFieldsFromText(
    JSON.stringify(payload)
  );
  if (extractedContent) return extractedContent;
  return JSON.stringify(payload, null, 2);
}

async function callWindFinancialDocsTool(args: {
  toolName: "get_company_announcements" | "get_financial_news";
  query: string;
  topK?: number;
}) {
  const skillDir = resolveWindMcpSkillDir();
  if (!skillDir) {
    return {
      ok: false as const,
      error:
        "未检测到 wind-mcp-skill。需要先安装万得 wind-mcp-skill，并配置 WIND_API_KEY 或万得本地配置。",
    };
  }
  try {
    const { stdout } = await execFileAsync(
      "node",
      [
        path.join(skillDir, "scripts", "cli.mjs"),
        "call",
        "financial_docs",
        args.toolName,
        JSON.stringify({ query: args.query, top_k: args.topK || 5 }),
      ],
      {
        cwd: skillDir,
        timeout: 120_000,
        maxBuffer: 12 * 1024 * 1024,
        env: process.env,
      }
    );
    const raw = stdout.trim();
    let text = raw;
    try {
      text = windPayloadToText(JSON.parse(raw));
    } catch {
      text = windPayloadToText(raw);
    }
    return { ok: true as const, text, skillDir };
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || error).trim();
    return {
      ok: false as const,
      error: detail || "万得 MCP 调用失败。",
      skillDir,
    };
  }
}

function buildWindAnnouncementFallbackReport(input: {
  prompt: string;
  announcementError?: string;
  newsError?: string;
}) {
  return [
    "# 公告解读",
    "",
    "## 任务理解",
    input.prompt,
    "",
    "## 当前状态",
    "本次没有拿到可复核的公告/新闻数据，因此不生成事实判断，避免把模型推测误当作专业数据。",
    "",
    "## 需要接入的数据能力",
    "- `financial_docs.get_company_announcements`：获取上市公司公告、年报、半年报、季报、监管披露等官方文件。",
    "- `financial_docs.get_financial_news`：获取媒体新闻、快讯、行业动态，用于补充市场反应与背景。",
    "",
    "## 错误信息",
    input.announcementError
      ? `- 公告数据：${input.announcementError}`
      : "- 公告数据：未执行。",
    input.newsError ? `- 新闻数据：${input.newsError}` : "- 新闻数据：未执行。",
    "",
    "## 建议下一步",
    "1. 在服务环境安装金融数据能力。",
    "2. 配置有效的数据源密钥或本地配置。",
    "3. 重新运行本任务，输出会变为基于真实公告/新闻数据的解读报告。",
  ].join("\n");
}

type WindReportWriterResult = {
  output: string;
  runtime: "hermes" | "openclaw" | "employee-agent";
  runId?: string;
  fallbackReason?: string;
};

function buildWindReportWriterPrompt(input: {
  reportType: "announcement_digest";
  prompt: string;
  announcementText: string;
  newsText: string;
}) {
  const sourceText = [
    "## Wind 官方公告数据",
    input.announcementText || "未返回公告数据。",
    "",
    "## Wind 财经新闻数据",
    input.newsText || "未返回新闻数据。",
  ].join("\n");
  return [
    "你是金融机构内部的 Wind 专业报告写作员。",
    "",
    "你只基于 employee-agent 提供的 Wind Data Pack 和用户需求生成中文 Markdown。",
    "禁止编造公告事实、精确数字、发布日期、来源或投资结论；资料不足时必须写入「风险点与不确定性」。",
    "不得输出买入/卖出/持有等投资建议；只能输出业务分析、影响路径、风险和待跟踪事项。",
    "",
    `reportType: ${input.reportType}`,
    "",
    "用户需求：",
    input.prompt,
    "",
    "Wind Data Pack：",
    sourceText,
    "",
    "请严格按以下结构输出：",
    "# 公告解读",
    "## 一句话结论",
    "## 关键公告事实",
    "## 对公司经营/财务/估值的可能影响",
    "## 市场与舆情信号",
    "## 风险点与不确定性",
    "## 需要继续跟踪的问题",
    "## 来源线索",
  ].join("\n");
}

async function tryRunWindReportWriter(input: {
  prompt: string;
  user: LabUser;
  taskRunId: string;
  announcementText: string;
  newsText: string;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
}): Promise<WindReportWriterResult | null> {
  try {
    const run = await dispatchManagedHermesStage({
      user: input.user,
      agentDefinitionId: "wind-report-writer",
      prompt: buildWindReportWriterPrompt({
        reportType: "announcement_digest",
        prompt: input.prompt,
        announcementText: input.announcementText,
        newsText: input.newsText,
      }),
      clusterRunId: input.taskRunId,
      onEvent: event =>
        input.onProviderEvent?.({
          ...event,
          agentDefinitionId: "wind-report-writer",
        }),
    });
    const output = String(run.output || run.summary || "").trim();
    if (!output) throw new Error("wind_report_writer_empty_output");
    return {
      output,
      runtime: "hermes",
      runId: run.id,
    };
  } catch (error: any) {
    console.warn(
      "[TASK-WORKBENCH-LAB] wind-report-writer failed; falling back",
      {
        error: error?.message || String(error),
      }
    );
    return null;
  }
}

async function buildWindAnnouncementAnalysis(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  taskRunId: string;
  announcementText: string;
  newsText: string;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
}): Promise<WindReportWriterResult> {
  const sourceText = [
    "## Wind 官方公告数据",
    input.announcementText || "未返回公告数据。",
    "",
    "## Wind 财经新闻数据",
    input.newsText || "未返回新闻数据。",
  ].join("\n");
  if (!input.user.adoptId || !input.user.claw) {
    return {
      output: [
        "# 公告解读",
        "",
        "## 任务理解",
        input.prompt,
        "",
        "## Wind 原始资料摘要",
        sourceText.slice(0, 12_000),
        "",
        "## 待完成",
        "当前用户运行时未提供 OpenClaw 上下文，已保存 Wind 原始资料；请补充运行时后生成正式解读。",
      ].join("\n"),
      runtime: "employee-agent",
    };
  }
  const hermesResult = await tryRunWindReportWriter({
    prompt: input.prompt,
    user: input.user,
    taskRunId: input.taskRunId,
    announcementText: input.announcementText,
    newsText: input.newsText,
    onProviderEvent: input.onProviderEvent,
  });
  if (hermesResult) return hermesResult;

  const output = await callOpenClawTask({
    claw: input.user.claw,
    adoptId: input.user.adoptId,
    timeoutMs: input.template.maxDurationMs || 600_000,
    prompt: [
      "你是金融机构内部的公告解读分析师。只基于下方 Wind 返回资料和用户输入生成中文 Markdown，不要编造不存在的公告事实。",
      "",
      "用户需求：",
      input.prompt,
      "",
      sourceText,
      "",
      "请严格按以下结构输出：",
      "# 公告解读",
      "## 一句话结论",
      "## 关键公告事实",
      "## 对公司经营/财务/估值的可能影响",
      "## 市场与舆情信号",
      "## 风险点与不确定性",
      "## 需要继续跟踪的问题",
      "## 来源线索",
    ].join("\n"),
  });
  return {
    output,
    runtime: "openclaw",
    fallbackReason: "wind-report-writer unavailable",
  };
}

async function runWindAnnouncementDigestTask(input: {
  template: TaskTemplate;
  prompt: string;
  user: LabUser;
  inputOptions?: Record<string, unknown>;
  onStageStarted?: (stageId: string) => void;
  onProviderEvent?: (
    event: ProviderStreamEvent & { agentDefinitionId: string }
  ) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
}): Promise<TaskRunResult> {
  if (!input.user.workspace)
    throw new Error("wind_announcement_user_workspace_missing");
  const startedAt = new Date().toISOString();
  const taskRunId = `wind-announcement-${Date.now()}`;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRunId)}/outputs`;
  const outputAbsRoot = path.join(input.user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  input.onStageStarted?.("wind_announcement_reader");
  const announcement = await callWindFinancialDocsTool({
    toolName: "get_company_announcements",
    query: input.prompt,
    topK: 6,
  });
  const news = await callWindFinancialDocsTool({
    toolName: "get_financial_news",
    query: input.prompt,
    topK: 5,
  });

  const sourceMarkdown = [
    "# 万得公告与新闻资料包",
    "",
    "## 公告数据",
    announcement.ok
      ? announcement.text || "万得未返回公告正文。"
      : `调用失败：${announcement.error}`,
    "",
    "## 新闻数据",
    news.ok ? news.text || "万得未返回新闻正文。" : `调用失败：${news.error}`,
  ].join("\n");
  const sourceRel = `${outputRelRoot}/announcement-sources.md`;
  writeFileSync(
    path.join(input.user.workspace, sourceRel),
    sourceMarkdown,
    "utf8"
  );

  const sourceStage = makeResearchPptStage({
    stageId: "wind_announcement_reader",
    personaId: "reader",
    agentDefinitionId: "wind-announcement-reader",
    output: sourceMarkdown,
    artifacts: [
      workspaceArtifact({
        user: input.user,
        rel: sourceRel,
        type: "markdown",
        mimeType: "text/markdown; charset=utf-8",
      }),
    ],
    metadata: {
      role: "Reader",
      stageTitle: "检索员读取万得公告与财经新闻数据",
      runtime: "wind-mcp",
      windSkillDir: announcement.ok
        ? announcement.skillDir
        : news.ok
          ? news.skillDir
          : undefined,
      announcementOk: announcement.ok,
      newsOk: news.ok,
    },
  });
  input.onStageDone?.(sourceStage);

  const hasWindData =
    (announcement.ok && Boolean(announcement.text?.trim())) ||
    (news.ok && Boolean(news.text?.trim()));
  input.onStageStarted?.("impact_analyst");
  const reportResult = hasWindData
    ? await buildWindAnnouncementAnalysis({
        template: input.template,
        prompt: input.prompt,
        user: input.user,
        taskRunId,
        announcementText: announcement.ok ? announcement.text : "",
        newsText: news.ok ? news.text : "",
        onProviderEvent: input.onProviderEvent,
      })
    : {
        output: buildWindAnnouncementFallbackReport({
          prompt: input.prompt,
          announcementError: announcement.ok ? undefined : announcement.error,
          newsError: news.ok ? undefined : news.error,
        }),
        runtime: "employee-agent" as const,
      };
  const reportMarkdown = reportResult.output;

  const reportRel = `${outputRelRoot}/announcement-digest.md`;
  const docxRel = `${outputRelRoot}/announcement-digest.docx`;
  const previewRel = `${outputRelRoot}/announcement-digest-preview.html`;
  writeFileSync(
    path.join(input.user.workspace, reportRel),
    reportMarkdown,
    "utf8"
  );
  const docxBuffer = await markdownToDocxBuffer({
    title: "公告解读",
    markdown: reportMarkdown,
    disclaimer:
      "本报告由 AI 助手生成，仅用于数据研究与风险提示，不构成投资建议、买卖建议或收益承诺。投资有风险，决策需谨慎。",
  });
  writeFileSync(path.join(input.user.workspace, docxRel), docxBuffer);
  writeFileSync(
    path.join(input.user.workspace, previewRel),
    buildWordCompatibleHtml("公告解读", reportMarkdown),
    "utf8"
  );

  const reportArtifacts = [
    {
      id: `workspace:${docxRel}`,
      type: "file",
      name: path.basename(docxRel),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      previewUrl: workspaceDownloadUrl(input.user.adoptId || "", previewRel),
      downloadUrl: workspaceDownloadUrl(input.user.adoptId || "", docxRel),
      metadata: {
        source: "task-workbench-workspace",
        workspacePath: docxRel,
        previewWorkspacePath: previewRel,
        size: statSync(path.join(input.user.workspace, docxRel)).size,
      },
    } as AgentArtifact,
    workspaceArtifact({
      user: input.user,
      rel: reportRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const analystStage = makeResearchPptStage({
    stageId: "impact_analyst",
    personaId: "writer",
    agentDefinitionId: "wind-report-writer",
    output: reportMarkdown,
    artifacts: reportArtifacts,
    metadata: {
      role: "Writer",
      stageTitle: "专业写作员生成公告影响解读",
      runtime: hasWindData
        ? `wind-mcp+${reportResult.runtime}`
        : "employee-agent",
      profile:
        reportResult.runtime === "hermes" ? "wind-report-writer" : undefined,
      runId: reportResult.runId,
      artifactType: "html",
      fallbackReason: reportResult.fallbackReason,
      windDataAvailable: hasWindData,
    },
  });
  input.onStageDone?.(analystStage);

  const stages = [sourceStage, analystStage];
  const artifacts = [
    ...reportArtifacts,
    workspaceArtifact({
      user: input.user,
      rel: sourceRel,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
    }),
  ];
  const taskRun: TaskRunResult = {
    taskRunId,
    taskTemplateId: input.template.id,
    taskTemplateVersion: input.template.version,
    taskTemplateChainHash: `wind-announcement:${input.template.version}`,
    status: hasWindData ? "completed" : "partial_success",
    stages,
    artifacts,
    upstreamCitations: [],
    disclaimers: input.template.outputPolicy.disclaimers,
    metadata: {
      disclaimers: input.template.outputPolicy.disclaimers,
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      rawUserPrompt: input.prompt,
      artifactType: "html",
      runtime: hasWindData
        ? `wind-mcp+${reportResult.runtime}`
        : "employee-agent",
      writerRuntime: reportResult.runtime,
      writerProfile:
        reportResult.runtime === "hermes" ? "wind-report-writer" : undefined,
      writerRunId: reportResult.runId,
      fallbackReason: reportResult.fallbackReason,
      windDataAvailable: hasWindData,
      workspaceOutputRoot: outputRelRoot,
    },
    runtimeSnapshotJson: {
      taskTemplateId: input.template.id,
      taskTemplateVersion: input.template.version,
      taskTemplateName: input.template.displayName,
      chainHash: `wind-announcement:${input.template.version}`,
      stageSnapshots: input.template.stages.map(stage => ({
        stageId: stage.id,
        stageType: stage.stageType,
        personaId: stage.personaId,
        agentDefinitionId: stage.agentDefinitionId,
        inputMapping: stage.inputMapping,
        timeoutMs: stage.timeoutMs,
        onFailure: stage.onFailure,
      })),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  persistTaskWorkbenchHistory({
    user: input.user,
    taskRun,
    prompt: input.prompt,
    inputOptions: input.inputOptions,
  });
  return taskRun;
}

function cleanupGeneratedArtifacts() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [key, value] of generatedArtifacts.entries()) {
    if (value.createdAt < cutoff) generatedArtifacts.delete(key);
  }
}

function safeFileName(input: string) {
  return (
    String(input || "task-workbench-output")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "task-workbench-output"
  );
}

function taskWorkbenchRelRoot(taskRunId: string) {
  const safeId =
    String(taskRunId || `task-${Date.now()}`)
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 96) || `task-${Date.now()}`;
  return `office/task-workbench/${safeId}`;
}

function attachGeneratedReportArtifacts(taskRun: TaskRunResult): TaskRunResult {
  if (taskRun.taskTemplateId !== "stock_ppt_report") return taskRun;
  const stageIndex = taskRun.stages.findIndex(
    stage => stage.agentDefinitionId === "task-stock"
  );
  if (stageIndex < 0) return taskRun;
  const stage = taskRun.stages[stageIndex];
  if (stage.status !== "success") return taskRun;
  const body = String(
    stage.runResult?.output || stage.runResult?.summary || ""
  ).trim();
  if (!body) return taskRun;

  cleanupGeneratedArtifacts();
  const key = `${taskRun.taskRunId}-stock-report`;
  const reportFileName = "股票数据研究报告.doc";
  const reportHtml = buildWordCompatibleHtml("股票数据研究报告", body);
  generatedArtifacts.set(key, {
    fileName: reportFileName,
    mimeType: "application/msword; charset=utf-8",
    body: reportHtml,
    createdAt: Date.now(),
  });

  const artifact: AgentArtifact = {
    id: key,
    type: "file",
    name: reportFileName,
    mimeType: "application/msword",
    previewUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}`,
    downloadUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}?download=1`,
    metadata: {
      source: "task-workbench-generated-report",
      size: Buffer.byteLength(reportHtml, "utf8"),
    },
  };

  const stages = taskRun.stages.map((item, index) =>
    index === stageIndex
      ? { ...item, artifacts: [...(item.artifacts || []), artifact] }
      : item
  );
  return {
    ...taskRun,
    stages,
    artifacts: [...(taskRun.artifacts || []), artifact],
  };
}

async function attachGeneratedOfficeArtifacts(
  taskRun: TaskRunResult
): Promise<TaskRunResult> {
  if (
    !["market_research_brief", "meeting_prep_agent"].includes(
      taskRun.taskTemplateId
    )
  )
    return taskRun;
  if (
    (taskRun.artifacts || []).some(
      artifact => artifact.metadata?.source === "sg-office-builder"
    )
  )
    return taskRun;
  if (
    (taskRun.artifacts || []).some(
      artifact =>
        artifact.metadata?.source === "remote-harness-artifact" &&
        (artifact.previewUrl || /\.docx?$/i.test(artifact.name))
    )
  )
    return taskRun;
  const writerIndex = taskRun.stages.findIndex(stage => {
    const role = String(
      stage.runResult?.metadata?.role || stage.personaId || ""
    ).toLowerCase();
    return (
      role === "writer" ||
      /writer/.test(stage.agentDefinitionId) ||
      /writer/.test(stage.stageId)
    );
  });
  if (writerIndex < 0) return taskRun;
  const stage = taskRun.stages[writerIndex];
  if (stage.status !== "success") return taskRun;
  const body = String(
    stage.runResult?.output || stage.runResult?.summary || ""
  ).trim();
  if (!body) return taskRun;

  cleanupGeneratedArtifacts();
  const artifactType = String(
    stage.runResult?.metadata?.artifactType ||
      taskRun.metadata?.artifactType ||
      "docx"
  );
  const officeKind = artifactType === "pptx" ? "pptx" : "docx";
  const extension = officeKind === "pptx" ? "html" : "docx";
  const mimeType =
    officeKind === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "text/html; charset=utf-8";
  const title = artifactFileStem(taskRun.taskTemplateId, officeKind);
  const key = `${taskRun.taskRunId}-${taskRun.taskTemplateId}-${officeKind}`;
  const html = buildWordCompatibleHtml(title, body);
  const docx =
    officeKind === "docx"
      ? await markdownToDocxBuffer({
          title,
          markdown: body,
          disclaimer:
            "本报告由 AI 助手生成，仅用于数据研究与风险提示，不构成投资建议、买卖建议或收益承诺。投资有风险，决策需谨慎。",
        })
      : null;
  const fileName = `${title}.${extension}`;
  generatedArtifacts.set(key, {
    fileName,
    mimeType,
    body: docx || html,
    previewBody: officeKind === "docx" ? html : undefined,
    previewMimeType:
      officeKind === "docx" ? "text/html; charset=utf-8" : undefined,
    createdAt: Date.now(),
  });

  const artifact: AgentArtifact = {
    id: key,
    type: officeKind === "docx" ? "file" : "html",
    name: fileName,
    mimeType,
    previewUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}`,
    downloadUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}?download=1`,
    metadata: {
      source: "financial-harness-office-artifact",
      artifactType: officeKind,
      size: docx?.length || Buffer.byteLength(html, "utf8"),
    },
  };

  const stages = taskRun.stages.map((item, index) =>
    index === writerIndex
      ? { ...item, artifacts: [...(item.artifacts || []), artifact] }
      : item
  );
  return {
    ...taskRun,
    stages,
    artifacts: [...(taskRun.artifacts || []), artifact],
  };
}

async function attachTaskWorkbenchArtifacts(
  taskRun: TaskRunResult
): Promise<TaskRunResult> {
  return attachGeneratedOfficeArtifacts(
    attachGeneratedReportArtifacts(taskRun)
  );
}

function withMappedArtifactUrls(
  taskRun: TaskRunResult,
  artifactUrlBase: string,
  adoptId?: string
): TaskRunResult {
  const base = artifactUrlBase.replace(/\/+$/, "");
  const query = adoptId ? `adoptId=${encodeURIComponent(adoptId)}` : "";
  const mapArtifact = (artifact: AgentArtifact): AgentArtifact => {
    if (!artifact?.id) return artifact;
    const generated = generatedArtifacts.get(artifact.id);
    if (!generated) return artifact;
    const key = encodeURIComponent(artifact.id);
    const previewUrl = `${base}/${key}${query ? `?${query}` : ""}`;
    const downloadUrl = `${previewUrl}${query ? "&" : "?"}download=1`;
    return { ...artifact, previewUrl, downloadUrl };
  };
  return {
    ...taskRun,
    artifacts: (taskRun.artifacts || []).map(mapArtifact),
    stages: taskRun.stages.map(stage => ({
      ...stage,
      artifacts: (stage.artifacts || []).map(mapArtifact),
      runResult: stage.runResult
        ? {
            ...stage.runResult,
            artifacts: (stage.runResult.artifacts || []).map(mapArtifact),
          }
        : stage.runResult,
    })),
  };
}

function persistGeneratedArtifactsToWorkspace(
  taskRun: TaskRunResult,
  user: LabUser
): TaskRunResult {
  if (!user.adoptId || !user.workspace) return taskRun;
  const outputRelRoot = `${taskWorkbenchRelRoot(taskRun.taskRunId)}/outputs`;
  const outputAbsRoot = path.join(user.workspace, outputRelRoot);
  mkdirSync(outputAbsRoot, { recursive: true });

  const persistedById = new Map<string, string>();
  const persistArtifact = (artifact: AgentArtifact): AgentArtifact => {
    if (!artifact?.id) return artifact;
    const generated = generatedArtifacts.get(artifact.id);
    if (!generated) return artifact;
    const fileName = safeFileName(
      generated.fileName || artifact.name || `${artifact.id}.doc`
    );
    const rel = sanitizeRelPath(`${outputRelRoot}/${fileName}`);
    if (!rel) return artifact;
    const abs = path.normalize(path.join(user.workspace!, rel));
    if (!abs.startsWith(user.workspace! + path.sep)) return artifact;
    if (!persistedById.has(artifact.id)) {
      writeFileSync(abs, generated.body);
      persistedById.set(artifact.id, rel);
    }
    let previewUrl = artifact.previewUrl;
    if (generated.previewBody) {
      const previewFileName = safeFileName(
        fileName.replace(/\.[^.]+$/, "") + "-preview.html"
      );
      const previewRel = sanitizeRelPath(`${outputRelRoot}/${previewFileName}`);
      if (previewRel) {
        const previewAbs = path.normalize(
          path.join(user.workspace!, previewRel)
        );
        if (previewAbs.startsWith(user.workspace! + path.sep)) {
          writeFileSync(previewAbs, generated.previewBody, "utf8");
          previewUrl = `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(user.adoptId!)}&path=${encodeURIComponent(previewRel)}`;
        }
      }
    }
    const downloadUrl = `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(user.adoptId!)}&path=${encodeURIComponent(rel)}`;
    return {
      ...artifact,
      name: fileName,
      previewUrl,
      downloadUrl,
      metadata: {
        ...(artifact.metadata || {}),
        workspacePath: rel,
      },
    };
  };

  return {
    ...taskRun,
    artifacts: (taskRun.artifacts || []).map(persistArtifact),
    stages: taskRun.stages.map(stage => ({
      ...stage,
      artifacts: (stage.artifacts || []).map(persistArtifact),
      runResult: stage.runResult
        ? {
            ...stage.runResult,
            artifacts: (stage.runResult.artifacts || []).map(persistArtifact),
          }
        : stage.runResult,
    })),
    metadata: {
      ...(taskRun.metadata || {}),
      workspaceOutputRoot: outputRelRoot,
    },
  };
}

async function finalizeTaskWorkbenchRun(
  taskRun: TaskRunResult,
  user: LabUser,
  artifactUrlBase: string
) {
  const attachedRun = await attachTaskWorkbenchArtifacts(taskRun);
  return persistGeneratedArtifactsToWorkspace(
    withMappedArtifactUrls(attachedRun, artifactUrlBase, user.adoptId),
    user
  );
}

function writeSse(
  res: express.Response,
  type: string,
  payload: Record<string, unknown>
) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(redactSecrets({ type, ...payload }))}\n\n`);
}

export function createTaskWorkbenchLabHandlers(
  options: {
    enabled?: () => boolean;
    adminOnly?: boolean;
    artifactUrlBase?: string;
    useOpenClaw?: boolean;
    authenticateUser?: (
      req: express.Request,
      res: express.Response
    ) => Promise<LabUser | null>;
    createRunner?: (
      user: LabUser,
      callbacks?: RunnerCallbacks
    ) => TaskTemplateRunner;
    routePrompt?: (input: {
      prompt: string;
      selectedTemplateId?: string | null;
      user: LabUser;
    }) => Promise<
      TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }
    >;
  } = {}
) {
  const adminOnly = options.adminOnly ?? true;
  const artifactUrlBase =
    options.artifactUrlBase ||
    "/api/admin/task-workbench-lab/generated-artifacts";
  const useOpenClaw = options.useOpenClaw ?? false;

  async function finalizeAndPersist(
    taskRun: TaskRunResult,
    user: LabUser,
    prompt: string,
    inputOptions?: Record<string, unknown>
  ) {
    const finalRun = await finalizeTaskWorkbenchRun(
      taskRun,
      user,
      artifactUrlBase
    );
    persistTaskWorkbenchHistory({
      user,
      taskRun: finalRun,
      prompt,
      inputOptions,
    });
    return finalRun;
  }

  async function authenticate(req: express.Request, res: express.Response) {
    if (!(options.enabled || isTaskWorkbenchLabEnabled)()) {
      res.status(404).json({ error: "not_found" });
      return null;
    }
    const user = await (options.authenticateUser || defaultAuthenticateUser)(
      req,
      res
    );
    if (!user) {
      if (!res.headersSent) res.status(401).json({ error: "unauthorized" });
      return null;
    }
    if (adminOnly && user.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    const allowUserIds = parseAllowUserIds();
    if (adminOnly && allowUserIds.size > 0 && !allowUserIds.has(user.id)) {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    return user;
  }

  return {
    listTemplates: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const runner = options.createRunner
        ? options.createRunner(user)
        : createDefaultRunner(user);
      const ids = [
        "market_research_brief",
        "excel_fill",
        "meeting_prep_agent",
        "meeting_notes",
        "wind_announcement_digest",
        "research_ppt",
        "video_outline",
      ];
      const requestedIds = new Set(
        String(req.query?.ids || "")
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      );
      const idsToLoad = requestedIds.size
        ? ids.filter(id => requestedIds.has(id))
        : ids;
      const templates = [];
      for (const id of idsToLoad) {
        const result = await runner.loadTemplate(id);
        if (result.ok) templates.push(result.value);
      }
      return res.json({
        templates: redactSecrets(templates),
        source: "task-workbench-lab",
      });
    },
    routePrompt: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = routeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_request", detail: parsed.error.message });
      }
      const decision = await (
        options.routePrompt || (input => routeTaskWorkbenchPrompt(input))
      )({
        prompt: parsed.data.prompt,
        selectedTemplateId: parsed.data.taskTemplateId || null,
        user,
      });
      return res.json({
        decision: redactSecrets(decision),
        source: "task-workbench-lab",
      });
    },
    runTask: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = runBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_request", detail: parsed.error.message });
      }
      const runner = options.createRunner
        ? options.createRunner(user)
        : createDefaultRunner(user);
      const template = await runner.loadTemplate(parsed.data.taskTemplateId);
      if (!template.ok) {
        return res
          .status(unauthorizedStatus(template.error.kind))
          .json({ error: template.error.kind, detail: template.error.detail });
      }
      if (template.value.id === "research_ppt") {
        try {
          const pptRun = await runResearchPptTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
            inputOptions: parsed.data.inputOptions,
          });
          return res.json({
            taskRun: redactSecrets(pptRun),
            source: "task-workbench-research-ppt",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "research_ppt_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (template.value.id === "wind_announcement_digest") {
        try {
          const windRun = await runWindAnnouncementDigestTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
            inputOptions: parsed.data.inputOptions,
          });
          return res.json({
            taskRun: redactSecrets(windRun),
            source: "task-workbench-wind-announcement",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "wind_announcement_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (template.value.id === "meeting_notes") {
        try {
          const meetingRun = await runMeetingNotesTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
            inputOptions: parsed.data.inputOptions,
          });
          return res.json({
            taskRun: redactSecrets(meetingRun),
            source: "task-workbench-meeting-notes",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "meeting_notes_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (template.value.id === "excel_fill") {
        try {
          const excelRun = await runExcelFillTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
            inputOptions: parsed.data.inputOptions,
          });
          return res.json({
            taskRun: redactSecrets(excelRun),
            source: "task-workbench-excel-fill",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "excel_fill_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (template.value.id === "video_outline") {
        try {
          const videoRun = await runVideoOutlineTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
            inputOptions: parsed.data.inputOptions,
          });
          return res.json({
            taskRun: redactSecrets(videoRun),
            source: "task-workbench-video-outline",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "video_outline_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (useOpenClaw) {
        try {
          const openClawRun = await runOpenClawTask({
            template: template.value,
            prompt: parsed.data.prompt,
            user,
          });
          const finalRun = await finalizeAndPersist(
            openClawRun,
            user,
            parsed.data.prompt,
            parsed.data.inputOptions
          );
          return res.json({
            taskRun: redactSecrets(finalRun),
            source: "task-workbench-openclaw",
          });
        } catch (error: any) {
          return res.status(500).json({
            error: "openclaw_dispatch_failed",
            detail: error?.message || String(error),
          });
        }
      }
      if (remoteHarnessExecutorEnabled()) {
        const financeDataPack = await buildFinanceDataPackForHarness({
          template: template.value,
          prompt: parsed.data.prompt,
          harnessPlan: parsed.data.harnessPlan,
        });
        const financeComputePack = await buildFinanceComputePackForHarness({
          template: template.value,
          prompt: parsed.data.prompt,
          harnessPlan: parsed.data.harnessPlan,
          dataPack: financeDataPack,
        });
        const remoteRun = await executeRemoteHarness({
          template: template.value,
          prompt: parsed.data.prompt,
          harnessPlan: parsed.data.harnessPlan,
          financeDataPack,
          financeComputePack,
        });
        if (remoteRun.ok) {
          const finalRun = await finalizeAndPersist(
            remoteRun.value,
            user,
            parsed.data.prompt,
            parsed.data.inputOptions
          );
          return res.json({
            taskRun: redactSecrets(finalRun),
            source: "task-workbench-lab",
          });
        }
        console.warn(
          "[TASK-WORKBENCH-LAB] remote harness executor fallback:",
          remoteRun.error.detail
        );
      }
      const run = await runner.runTask({
        template: template.value,
        userInput: parsed.data.prompt,
        context: {
          userId: user.id,
          adoptId: user.adoptId || "task-workbench-lab",
          metadata: parsed.data.harnessPlan
            ? { harnessPlan: parsed.data.harnessPlan }
            : undefined,
        },
      });
      if (!run.ok) {
        return res
          .status(unauthorizedStatus(run.error.kind))
          .json({ error: run.error.kind, detail: run.error.detail });
      }
      const finalRun = await finalizeAndPersist(
        run.value,
        user,
        parsed.data.prompt,
        parsed.data.inputOptions
      );
      return res.json({
        taskRun: redactSecrets(finalRun),
        source: "task-workbench-lab",
      });
    },
    runTaskStream: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = runBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_request", detail: parsed.error.message });
      }

      res.status(200);
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("connection", "keep-alive");
      res.setHeader("x-accel-buffering", "no");
      (res as any).flushHeaders?.();
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: task-workbench-keepalive ${Date.now()}\n\n`);
        }
      }, 15_000);

      const runner = options.createRunner
        ? options.createRunner(user, {
            onTaskEvent: event => writeSse(res, event.type, { event }),
            onProviderEvent: event => writeSse(res, "agent_event", { event }),
          })
        : createDefaultRunner(user, {
            onTaskEvent: event => writeSse(res, event.type, { event }),
            onProviderEvent: event => writeSse(res, "agent_event", { event }),
          });

      writeSse(res, "run_started", {
        taskTemplateId: parsed.data.taskTemplateId,
        promptBytes: Buffer.byteLength(parsed.data.prompt, "utf8"),
        startedAt: new Date().toISOString(),
        harnessPlan: parsed.data.harnessPlan,
      });

      try {
        const template = await runner.loadTemplate(parsed.data.taskTemplateId);
        if (!template.ok) {
          writeSse(res, "run_failed", { error: template.error });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        writeSse(res, "template_loaded", { template: template.value });
        if (template.value.id === "research_ppt") {
          try {
            const startedStageIds = new Set<string>();
            const sentStageIds = new Set<string>();
            const notifyStageStarted = (stageId: string) => {
              if (startedStageIds.has(stageId) || sentStageIds.has(stageId))
                return;
              startedStageIds.add(stageId);
              const templateStage = template.value.stages.find(
                item => item.id === stageId
              );
              writeSse(res, "stage_started", {
                event: {
                  stageId,
                  agentDefinitionId:
                    templateStage?.agentDefinitionId || stageId,
                  displayName: templateStage?.displayName || stageId,
                },
              });
            };
            const notifyStageDone = (
              stage: TaskRunResult["stages"][number]
            ) => {
              notifyStageStarted(stage.stageId);
              sentStageIds.add(stage.stageId);
              writeSse(res, "stage_done", { event: { stage } });
            };
            notifyStageStarted(template.value.stages[0]?.id || "source_reader");
            const pptRun = await runResearchPptTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
              inputOptions: parsed.data.inputOptions,
              onStageStarted: notifyStageStarted,
              onStageDone: notifyStageDone,
              onProviderEvent: event => writeSse(res, "agent_event", { event }),
            });
            for (const stage of pptRun.stages) {
              if (!sentStageIds.has(stage.stageId)) notifyStageDone(stage);
            }
            writeSse(res, "run_done", {
              taskRun: redactSecrets(pptRun),
              source: "task-workbench-research-ppt",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (template.value.id === "wind_announcement_digest") {
          try {
            const startedStageIds = new Set<string>();
            const sentStageIds = new Set<string>();
            const notifyStageStarted = (stageId: string) => {
              if (startedStageIds.has(stageId)) return;
              startedStageIds.add(stageId);
              const templateStage = template.value.stages.find(
                item => item.id === stageId
              );
              writeSse(res, "stage_started", {
                event: {
                  stageId,
                  agentDefinitionId:
                    templateStage?.agentDefinitionId || stageId,
                  displayName: templateStage?.displayName || stageId,
                },
              });
            };
            const notifyStageDone = (
              stage: TaskRunResult["stages"][number]
            ) => {
              notifyStageStarted(stage.stageId);
              sentStageIds.add(stage.stageId);
              writeSse(res, "stage_done", { event: { stage } });
            };
            notifyStageStarted(
              template.value.stages[0]?.id || "wind_announcement_reader"
            );
            const windRun = await runWindAnnouncementDigestTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
              inputOptions: parsed.data.inputOptions,
              onStageStarted: notifyStageStarted,
              onProviderEvent: event => writeSse(res, "agent_event", { event }),
              onStageDone: notifyStageDone,
            });
            for (const stage of windRun.stages) {
              if (!sentStageIds.has(stage.stageId)) notifyStageDone(stage);
            }
            writeSse(res, "run_done", {
              taskRun: redactSecrets(windRun),
              source: "task-workbench-wind-announcement",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (template.value.id === "video_outline") {
          try {
            const startedStageIds = new Set<string>();
            const sentStageIds = new Set<string>();
            const notifyStageStarted = (stageId: string) => {
              if (startedStageIds.has(stageId)) return;
              startedStageIds.add(stageId);
              const templateStage = template.value.stages.find(
                item => item.id === stageId
              );
              writeSse(res, "stage_started", {
                event: {
                  stageId,
                  agentDefinitionId:
                    templateStage?.agentDefinitionId || stageId,
                  displayName: templateStage?.displayName || stageId,
                },
              });
            };
            const notifyStageDone = (
              stage: TaskRunResult["stages"][number]
            ) => {
              notifyStageStarted(stage.stageId);
              sentStageIds.add(stage.stageId);
              writeSse(res, "stage_done", { event: { stage } });
            };
            notifyStageStarted(
              template.value.stages[0]?.id || "video_source_reader"
            );
            const videoRun = await runVideoOutlineTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
              inputOptions: parsed.data.inputOptions,
              onStageStarted: notifyStageStarted,
              onStageDone: notifyStageDone,
            });
            for (const stage of videoRun.stages) {
              if (!sentStageIds.has(stage.stageId)) notifyStageDone(stage);
            }
            writeSse(res, "run_done", {
              taskRun: redactSecrets(videoRun),
              source: "task-workbench-video-outline",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (template.value.id === "meeting_notes") {
          try {
            const startedStageIds = new Set<string>();
            const sentStageIds = new Set<string>();
            const notifyStageStarted = (stageId: string) => {
              if (startedStageIds.has(stageId)) return;
              startedStageIds.add(stageId);
              const templateStage = template.value.stages.find(
                item => item.id === stageId
              );
              writeSse(res, "stage_started", {
                event: {
                  stageId,
                  agentDefinitionId:
                    templateStage?.agentDefinitionId || stageId,
                  displayName: templateStage?.displayName || stageId,
                },
              });
            };
            const notifyStageDone = (
              stage: TaskRunResult["stages"][number]
            ) => {
              notifyStageStarted(stage.stageId);
              sentStageIds.add(stage.stageId);
              writeSse(res, "stage_done", { event: { stage } });
            };
            notifyStageStarted(
              template.value.stages[0]?.id || "audio_transcriber"
            );
            const meetingRun = await runMeetingNotesTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
              inputOptions: parsed.data.inputOptions,
              onStageStarted: notifyStageStarted,
              onStageDone: notifyStageDone,
            });
            for (const stage of meetingRun.stages) {
              if (!sentStageIds.has(stage.stageId)) notifyStageDone(stage);
            }
            writeSse(res, "run_done", {
              taskRun: redactSecrets(meetingRun),
              source: "task-workbench-meeting-notes",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (template.value.id === "excel_fill") {
          try {
            const startedStageIds = new Set<string>();
            const sentStageIds = new Set<string>();
            const notifyStageStarted = (stageId: string) => {
              if (startedStageIds.has(stageId)) return;
              startedStageIds.add(stageId);
              const templateStage = template.value.stages.find(
                item => item.id === stageId
              );
              writeSse(res, "stage_started", {
                event: {
                  stageId,
                  agentDefinitionId:
                    templateStage?.agentDefinitionId || stageId,
                  displayName: templateStage?.displayName || stageId,
                },
              });
            };
            const notifyStageDone = (
              stage: TaskRunResult["stages"][number]
            ) => {
              notifyStageStarted(stage.stageId);
              sentStageIds.add(stage.stageId);
              writeSse(res, "stage_done", { event: { stage } });
            };
            notifyStageStarted(template.value.stages[0]?.id || "excel_planner");
            const excelRun = await runExcelFillTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
              inputOptions: parsed.data.inputOptions,
              onStageStarted: notifyStageStarted,
              onStageDone: notifyStageDone,
            });
            for (const stage of excelRun.stages) {
              if (!sentStageIds.has(stage.stageId)) notifyStageDone(stage);
            }
            writeSse(res, "run_done", {
              taskRun: redactSecrets(excelRun),
              source: "task-workbench-excel-fill",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (useOpenClaw) {
          try {
            const openClawRun = await runOpenClawTask({
              template: template.value,
              prompt: parsed.data.prompt,
              user,
            });
            const finalRun = await finalizeAndPersist(
              openClawRun,
              user,
              parsed.data.prompt,
              parsed.data.inputOptions
            );
            writeSse(res, "run_done", {
              taskRun: finalRun,
              source: "task-workbench-openclaw",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          } catch (error: any) {
            writeSse(res, "run_failed", {
              error: {
                kind: "dispatch_failed",
                detail: error?.message || String(error),
              },
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
        }
        if (remoteHarnessExecutorEnabled()) {
          const financeDataPack = await buildFinanceDataPackForHarness({
            template: template.value,
            prompt: parsed.data.prompt,
            harnessPlan: parsed.data.harnessPlan,
          });
          const financeComputePack = await buildFinanceComputePackForHarness({
            template: template.value,
            prompt: parsed.data.prompt,
            harnessPlan: parsed.data.harnessPlan,
            dataPack: financeDataPack,
          });
          if (financeDataPack) {
            writeSse(res, "data_pack_built", {
              dataPack: summarizeFinanceDataPack(financeDataPack),
            });
          }
          if (financeComputePack) {
            writeSse(res, "compute_pack_built", {
              computePack: summarizeFinanceComputePack(financeComputePack),
            });
          }
          writeSse(res, "harness_executor_started", {
            harnessRunId: parsed.data.harnessPlan?.runId,
            templateId: parsed.data.harnessPlan?.templateId,
          });
          const remoteRun = await executeRemoteHarnessStream(
            {
              template: template.value,
              prompt: parsed.data.prompt,
              harnessPlan: parsed.data.harnessPlan,
              financeDataPack,
              financeComputePack,
            },
            {
              onStageStarted: event =>
                writeSse(res, "stage_started", { event }),
              onStageDone: stage =>
                writeSse(res, "stage_done", { event: { stage } }),
            }
          );
          if (remoteRun.ok) {
            const finalRun = await finalizeAndPersist(
              remoteRun.value,
              user,
              parsed.data.prompt,
              parsed.data.inputOptions
            );
            writeSse(res, "run_done", {
              taskRun: finalRun,
              source: "task-workbench-lab",
            });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
          writeSse(res, "harness_executor_fallback", {
            error: remoteRun.error,
          });
          console.warn(
            "[TASK-WORKBENCH-LAB] remote harness executor fallback:",
            remoteRun.error.detail
          );
        }
        const run = await runner.runTask({
          template: template.value,
          userInput: parsed.data.prompt,
          context: {
            userId: user.id,
            adoptId: user.adoptId || "task-workbench-lab",
            metadata: parsed.data.harnessPlan
              ? { harnessPlan: parsed.data.harnessPlan }
              : undefined,
          },
        });
        if (!run.ok) {
          writeSse(res, "run_failed", { error: run.error });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        const finalRun = await finalizeAndPersist(
          run.value,
          user,
          parsed.data.prompt,
          parsed.data.inputOptions
        );
        writeSse(res, "run_done", {
          taskRun: finalRun,
          source: "task-workbench-lab",
        });
        res.write("data: [DONE]\n\n");
        return res.end();
      } catch (error: any) {
        writeSse(res, "run_failed", {
          error: {
            kind: "dispatch_failed",
            detail: error?.message || String(error),
          },
        });
        res.write("data: [DONE]\n\n");
        return res.end();
      } finally {
        clearInterval(heartbeat);
      }
    },
    listHistory: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const taskTemplateId = String(req.query.taskTemplateId || "").trim();
      const records = readTaskWorkbenchIndex(user)
        .filter(
          item => !taskTemplateId || item.taskTemplateId === taskTemplateId
        )
        .slice(0, 100);
      return res.json({
        records: redactSecrets(records),
        source: "task-workbench-history",
      });
    },
    getHistoryRun: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const taskRun = readTaskWorkbenchRun(
        user,
        String(req.params.taskRunId || "")
      );
      if (!taskRun) return res.status(404).json({ error: "not_found" });
      return res.json({
        taskRun: redactSecrets(taskRun),
        source: "task-workbench-history",
      });
    },
    deleteHistoryRun: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const taskRunId = String(req.params.taskRunId || "");
      const before = readTaskWorkbenchIndex(user);
      const after = before.filter(item => item.id !== taskRunId);
      writeTaskWorkbenchIndex(user, after);
      return res.json({ ok: true, deleted: before.length !== after.length });
    },
    listPptTemplates: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const templates = getBuiltinPptTemplates().map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        available: item.available,
        thumbnailUrl: `/api/claw/office/task-workbench/research-ppt/templates/${encodeURIComponent(item.id)}/thumbnail?adoptId=${encodeURIComponent(user.adoptId || "")}`,
        previewUrls: [1, 2, 3]
          .map(
            page =>
              `/api/claw/office/task-workbench/research-ppt/templates/${encodeURIComponent(item.id)}/preview/${page}?adoptId=${encodeURIComponent(user.adoptId || "")}`
          )
          .filter((_, index) =>
            existsSync(
              path.join(
                APP_ROOT,
                "data/office-templates",
                `${item.id}-previews`,
                `slide-${String(index + 1).padStart(2, "0")}.jpeg`
              )
            )
          ),
      }));
      return res.json({ templates, source: "task-workbench-ppt-templates" });
    },
    pptTemplateThumbnail: async (
      req: express.Request,
      res: express.Response
    ) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const template = getBuiltinPptTemplates().find(
        item => item.id === String(req.params.id || "")
      );
      if (!template?.thumbnailPath || !existsSync(template.thumbnailPath))
        return res.status(404).end();
      res.setHeader("content-type", "image/jpeg");
      return res.sendFile(template.thumbnailPath);
    },
    pptTemplatePreview: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const template = getBuiltinPptTemplates().find(
        item => item.id === String(req.params.id || "")
      );
      if (!template) return res.status(404).end();
      const page = Math.max(1, Math.min(12, Number(req.params.page || 1) || 1));
      const previewPath = path.join(
        APP_ROOT,
        "data/office-templates",
        `${template.id}-previews`,
        `slide-${String(page).padStart(2, "0")}.jpeg`
      );
      if (!existsSync(previewPath)) return res.status(404).end();
      res.setHeader("content-type", "image/jpeg");
      return res.sendFile(previewPath);
    },
    generatedArtifact: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const key = String(req.params.key || "");
      const artifact = generatedArtifacts.get(key);
      if (!artifact) {
        return res.status(404).json({ error: "not_found" });
      }
      const download = String(req.query.download || "") === "1";
      const body =
        !download && artifact.previewBody
          ? artifact.previewBody
          : artifact.body;
      const isTextBody = typeof body === "string";
      res.setHeader(
        "content-type",
        isTextBody && !download
          ? artifact.previewMimeType || "text/html; charset=utf-8"
          : artifact.mimeType
      );
      if (download) {
        res.setHeader(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`
        );
      }
      return res.send(body);
    },
  };
}

export function registerTaskWorkbenchLabRoutes(app: express.Express) {
  const handlers = createTaskWorkbenchLabHandlers();
  app.get("/api/admin/task-workbench-lab/templates", handlers.listTemplates);
  app.post("/api/admin/task-workbench-lab/route", handlers.routePrompt);
  app.post("/api/admin/task-workbench-lab/run", handlers.runTask);
  app.post("/api/admin/task-workbench-lab/run-stream", handlers.runTaskStream);
  app.get("/api/admin/task-workbench-lab/history", handlers.listHistory);
  app.get(
    "/api/admin/task-workbench-lab/history/:taskRunId",
    handlers.getHistoryRun
  );
  app.delete(
    "/api/admin/task-workbench-lab/history/:taskRunId",
    handlers.deleteHistoryRun
  );
  app.get(
    "/api/admin/task-workbench-lab/generated-artifacts/:key",
    handlers.generatedArtifact
  );
}

export function registerOfficeTaskWorkbenchRoutes(app: express.Express) {
  const handlers = createTaskWorkbenchLabHandlers({
    enabled: () => true,
    adminOnly: false,
    useOpenClaw: false,
    artifactUrlBase: "/api/claw/office/task-workbench/generated-artifacts",
    authenticateUser: async (req, res) => {
      const adoptId = String(
        req.query.adoptId || req.body?.adoptId || ""
      ).trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId_required" });
        return null;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return null;
      return {
        id: Number((claw as any).userId),
        role: "user",
        adoptId,
        claw,
        workspace: resolveRuntimeWorkspace(claw, adoptId),
      };
    },
  });
  app.get("/api/claw/office/task-workbench/templates", handlers.listTemplates);
  app.post("/api/claw/office/task-workbench/route", handlers.routePrompt);
  app.post("/api/claw/office/task-workbench/run", handlers.runTask);
  app.post(
    "/api/claw/office/task-workbench/run-stream",
    handlers.runTaskStream
  );
  app.get("/api/claw/office/task-workbench/history", handlers.listHistory);
  app.get(
    "/api/claw/office/task-workbench/history/:taskRunId",
    handlers.getHistoryRun
  );
  app.delete(
    "/api/claw/office/task-workbench/history/:taskRunId",
    handlers.deleteHistoryRun
  );
  app.get(
    "/api/claw/office/task-workbench/research-ppt/templates",
    handlers.listPptTemplates
  );
  app.get(
    "/api/claw/office/task-workbench/research-ppt/templates/:id/thumbnail",
    handlers.pptTemplateThumbnail
  );
  app.get(
    "/api/claw/office/task-workbench/research-ppt/templates/:id/preview/:page",
    handlers.pptTemplatePreview
  );
  app.get(
    "/api/claw/office/task-workbench/generated-artifacts/:key",
    handlers.generatedArtifact
  );
}
