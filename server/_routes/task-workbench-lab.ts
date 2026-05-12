import express from "express";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AgentArtifact, AgentRegistryError } from "../../shared/types/agent";
import type { TaskRunResult, TaskTemplate, TaskTemplateRunner } from "../../shared/types/task-template";
import { JsonTaskTemplateRunner, type TaskTemplateRunnerEvent } from "../_core/agent/task-template-runner";
import { JsonAgentRegistry } from "../_core/agent/agent-registry";
import { AdapterAgentClusterRunner } from "../_core/agent/agent-cluster-runner";
import { ClaudeCodeProvider } from "../_core/agent/providers/claude-code-provider";
import { HermesProvider } from "../_core/agent/providers/hermes-provider";
import { LegacyBusinessAgentResolver } from "../_core/agent/providers/legacy-business-agent-resolver";
import { StockAnalysisProvider } from "../_core/agent/providers/stock-analysis-provider";
import { redactSecrets } from "../_core/agent/providers/http-utils";
import type { ProviderStreamEvent } from "../_core/agent/providers/types";
import { routeTaskWorkbenchPrompt, taskWorkbenchHarnessPlanSchema, type TaskWorkbenchRouterDecision } from "../_core/agent/task-workbench-router";
import { createContext } from "../_core/context";

type LabUser = { id: number; role: string };
let lastKillSwitchLogMs = 0;

type GeneratedArtifact = {
  fileName: string;
  mimeType: string;
  body: Buffer | string;
  createdAt: number;
};
const generatedArtifacts = new Map<string, GeneratedArtifact>();

const runBodySchema = z.object({
  taskTemplateId: z.string().min(1),
  prompt: z.string().min(1),
  harnessPlan: taskWorkbenchHarnessPlanSchema.optional(),
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
  artifactType: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    name: z.string().min(1),
    mimeType: z.string().optional(),
    contentBase64: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  permissionPolicy: z.record(z.string(), z.unknown()).optional(),
  manifestWorker: z.record(z.string(), z.unknown()).optional(),
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
});

function isTaskWorkbenchLabEnabled() {
  const legacyKillFile = process.env.AGENT_CLUSTER_LAB_KILL_FILE || "/tmp/lingxia-agent-cluster-lab.disabled";
  const killFile = process.env.TASK_WORKBENCH_LAB_KILL_FILE
    || (existsSync(legacyKillFile) ? legacyKillFile : "/tmp/lingxia-task-workbench-lab.disabled");
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
  return String(process.env.AGENT_CLUSTER_LAB_ENABLED || "false").toLowerCase() === "true";
}

function parseAllowUserIds() {
  return new Set(String(process.env.TASK_WORKBENCH_LAB_ALLOW_USER_IDS || process.env.AGENT_CLUSTER_LAB_ALLOW_USER_IDS || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0));
}

async function defaultAuthenticateUser(req: express.Request, res: express.Response): Promise<LabUser | null> {
  const ctx = await createContext({ req, res } as any);
  const user = ctx.user;
  return user ? { id: Number(user.id), role: String(user.role || "user") } : null;
}

type RunnerCallbacks = {
  onTaskEvent?: (event: TaskTemplateRunnerEvent) => void;
  onProviderEvent?: (event: ProviderStreamEvent & { agentDefinitionId: string }) => void;
};

function createDefaultRunner(user: LabUser, callbacks: RunnerCallbacks = {}): TaskTemplateRunner {
  const registry = new JsonAgentRegistry({
    resolveViewerContext: async (viewerUserId: number) => {
      const { getCoopProfile } = await import("../db/coop-identity");
      const profile = await getCoopProfile(viewerUserId);
      return { spaceId: profile.ok ? profile.value.spaceId : null };
    },
  });
  const clusterRunner = new AdapterAgentClusterRunner({
    userId: user.id,
    maxAgents: Number(process.env.TASK_WORKBENCH_LAB_MAX_AGENTS || process.env.AGENT_CLUSTER_LAB_MAX_AGENTS || 3),
    registry,
    onProviderEvent: callbacks.onProviderEvent,
    createAdapter: (provider) => {
      if (provider.runtimeFamily === "hermes") return new HermesProvider(provider);
      if (provider.runtimeFamily === "claude-code") return new ClaudeCodeProvider(provider);
      if (provider.runtimeFamily === "lingxia-local") return new StockAnalysisProvider(provider);
      return null;
    },
    resolveBinding: ({ definition, provider }) => new LegacyBusinessAgentResolver().resolve(definition, provider),
  });
  return new JsonTaskTemplateRunner({ clusterRunner, onTaskEvent: callbacks.onTaskEvent });
}

function unauthorizedStatus(kind: string) {
  if (kind === "unauthorized") return 403;
  if (kind === "not_found") return 404;
  return 400;
}

function remoteHarnessExecutorEndpoint() {
  return (process.env.TASK_WORKBENCH_HARNESS_ENDPOINT
    || process.env.LINGXIA_FIN_HARNESS_ENDPOINT
    || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT
    || process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT
    || "").trim();
}

function remoteHarnessExecutorEnabled() {
  return String(process.env.TASK_WORKBENCH_HARNESS_EXECUTOR || "false").toLowerCase() === "true"
    && Boolean(remoteHarnessExecutorEndpoint());
}

function remoteHarnessToken() {
  return process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN
    || process.env.TASK_WORKBENCH_HARNESS_TOKEN
    || process.env.HERMES_HTTP_KEY
    || "";
}

function compactSummary(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function inferTaskArtifactType(templateId: string, prompt: string) {
  const lower = prompt.toLowerCase();
  if (/\b(ppt|pptx|slide|slides|deck)\b/.test(lower) || /PPT|幻灯片|路演|汇报材料/.test(prompt)) return "pptx";
  if (/\b(doc|docx|word)\b/.test(lower) || /简报|报告|纪要|研究笔记|会议包/.test(prompt)) return "docx";
  if (templateId === "ai_topic_insight_ppt") return "pptx";
  return "docx";
}

function artifactFileStem(taskTemplateId: string, artifactType: string) {
  if (taskTemplateId === "meeting_prep_agent") return artifactType === "pptx" ? "客户会议准备材料" : "客户会议准备包";
  if (taskTemplateId === "market_research_brief") return artifactType === "pptx" ? "金融市场研究汇报" : "金融市场研究简报";
  return artifactType === "pptx" ? "任务汇报材料" : "任务交付文档";
}

type RemoteHarnessStage = z.infer<typeof remoteHarnessStageSchema>;
type RemoteHarnessExecuteResponse = z.infer<typeof remoteHarnessExecuteResponseSchema>;

function harnessRoleDisplayName(stage: Pick<RemoteHarnessStage, "role" | "profile">) {
  const role = String(stage.role || "").toLowerCase();
  if (role === "reader") return `\u68c0\u7d22\u5458 \u00b7 ${stage.profile}`;
  if (role === "analyst") return `\u5206\u6790\u5e08 \u00b7 ${stage.profile}`;
  if (role === "writer") return `\u5199\u4f5c\u5458 \u00b7 ${stage.profile}`;
  return `${stage.role || "\u4e13\u5458"} \u00b7 ${stage.profile}`;
}

function materializeRemoteStageArtifacts(stage: RemoteHarnessStage, harnessRunId: string): AgentArtifact[] {
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
    const artifactType = (["pptx", "html", "code", "markdown", "xlsx", "pdf", "image", "zip"].includes(String(item.type))
      ? item.type
      : "file") as AgentArtifact["type"];
    generatedArtifacts.set(key, { fileName, mimeType, body, createdAt: Date.now() });
    artifacts.push({
      id: key,
      type: artifactType,
      name: fileName,
      mimeType,
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

function buildRemoteHarnessStage(stage: RemoteHarnessStage, harnessPlan: unknown): TaskRunResult["stages"][number] {
  const now = new Date().toISOString();
  const output = stage.output || "";
  const failed = stage.status !== "success";
  const harnessRunId = harnessPlan && typeof harnessPlan === "object" && "runId" in harnessPlan
    ? String((harnessPlan as { runId?: unknown }).runId)
    : "remote-harness";
  const remoteArtifacts = materializeRemoteStageArtifacts(stage, harnessRunId);
  return {
    stageId: stage.stageId,
    personaId: (stage.role || stage.profile).toLowerCase(),
    agentDefinitionId: stage.profile,
    status: failed ? "failed" as const : "success" as const,
    durationMs: stage.durationMs || 0,
    artifacts: remoteArtifacts,
    ownCitations: [],
    upstreamCitations: [],
    warnings: failed && stage.error ? [stage.error] : undefined,
    runResult: {
      id: stage.runId || `${harnessRunId}-${stage.stageId}`,
      envelopeVersion: "v1" as const,
      agentDefinitionId: stage.profile,
      status: failed ? "failed" as const : "success" as const,
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
        sourceResearch: stage.sourceResearch || undefined,
        artifactType: stage.artifactType || undefined,
        permissionPolicy: stage.permissionPolicy,
        manifestWorker: stage.manifestWorker,
      },
      error: failed ? { code: "remote_harness_stage_failed", detail: stage.error || "remote harness stage failed" } : undefined,
      producedAt: now,
    },
  };
}

function buildRemoteHarnessTaskRun(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
  response: RemoteHarnessExecuteResponse;
}): TaskRunResult {
  const now = new Date().toISOString();
  const harnessPlan = taskWorkbenchHarnessPlanSchema.safeParse(input.response.harnessPlan).success
    ? taskWorkbenchHarnessPlanSchema.parse(input.response.harnessPlan)
    : input.harnessPlan;
  const harnessRunId = harnessPlan?.runId || `remote-${Date.now()}`;
  const stages = input.response.stages.map((stage) => buildRemoteHarnessStage(stage, harnessPlan));
  const artifacts = stages.flatMap((stage) => stage.artifacts || []);
  const taskStatus = input.response.status === "completed" && stages.every((stage) => stage.status === "success")
    ? "completed" as const
    : stages.some((stage) => stage.status === "success")
      ? "partial_success" as const
      : "failed" as const;
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
      artifactType: input.response.artifactType || inferTaskArtifactType(input.template.id, input.prompt),
      harnessPlan,
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
      stageSnapshots: input.template.stages.map((stage) => ({
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

async function executeRemoteHarness(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
}): Promise<{ ok: true; value: TaskRunResult } | { ok: false; error: AgentRegistryError }> {
  const endpoint = remoteHarnessExecutorEndpoint();
  const token = remoteHarnessToken();
  if (!endpoint || !token) {
    return { ok: false, error: { kind: "provider_unhealthy", detail: "remote harness executor is not configured" } };
  }

  const response = await fetch(`${endpoint.replace(/\/+$/, "")}${input.harnessPlan ? "/v1/harness/execute" : "/v1/harness/run"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      artifact_type: inferTaskArtifactType(input.template.id, input.prompt),
      selected_template_id: input.template.id === "market_research_brief"
        ? "market-researcher"
        : input.template.id === "meeting_prep_agent"
          ? "meeting-prep-agent"
          : null,
      harnessPlan: input.harnessPlan,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "dispatch_failed",
        detail: `remote harness executor failed: ${JSON.stringify(payload).slice(0, 300)}`,
      },
    };
  }
  const parsed = remoteHarnessExecuteResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: { kind: "validation_failed", detail: `invalid remote harness response: ${parsed.error.message}` } };
  }

  return {
    ok: true,
    value: buildRemoteHarnessTaskRun({
      template: input.template,
      prompt: input.prompt,
      harnessPlan: input.harnessPlan,
      response: parsed.data,
    }),
  };
}

type RemoteHarnessStreamCallbacks = {
  onStageStarted?: (event: Record<string, unknown>) => void;
  onStageDone?: (stage: TaskRunResult["stages"][number]) => void;
};

async function executeRemoteHarnessStream(input: {
  template: TaskTemplate;
  prompt: string;
  harnessPlan?: z.infer<typeof taskWorkbenchHarnessPlanSchema>;
}, callbacks: RemoteHarnessStreamCallbacks = {}): Promise<{ ok: true; value: TaskRunResult } | { ok: false; error: AgentRegistryError }> {
  const endpoint = remoteHarnessExecutorEndpoint();
  const token = remoteHarnessToken();
  if (!endpoint || !token) {
    return { ok: false, error: { kind: "provider_unhealthy", detail: "remote harness executor is not configured" } };
  }

  const response = await fetch(`${endpoint.replace(/\/+$/, "")}${input.harnessPlan ? "/v1/harness/execute-stream" : "/v1/harness/run-stream"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      artifact_type: inferTaskArtifactType(input.template.id, input.prompt),
      selected_template_id: input.template.id === "market_research_brief"
        ? "market-researcher"
        : input.template.id === "meeting_prep_agent"
          ? "meeting-prep-agent"
          : null,
      harnessPlan: input.harnessPlan,
    }),
  });
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
    const dataLines = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""));
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
    if (type === "stage_started" && payload.event && typeof payload.event === "object") {
      callbacks.onStageStarted?.({
        stageId: payload.event.stageId,
        agentDefinitionId: payload.event.agentDefinitionId || payload.event.profile,
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
        callbacks.onStageDone?.(buildRemoteHarnessStage(parsedStage.data, payload.harnessPlan || input.harnessPlan));
      }
      return;
    }
    if (type === "run_done") {
      const parsedResult = remoteHarnessExecuteResponseSchema.safeParse(payload.result);
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
    return { ok: false, error: { kind: "dispatch_failed", detail: "remote harness stream ended without run_done" } };
  }
  return {
    ok: true,
    value: buildRemoteHarnessTaskRun({
      template: input.template,
      prompt: input.prompt,
      harnessPlan: input.harnessPlan,
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
      const level = Math.min(3, (line.match(/^#+/)?.[0].length || 2));
      out.push(`<h${level}>${escapeHtml(line.replace(/^#+\s+/, ""))}</h${level}>`);
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

function buildWordCompatibleHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif; color: #1f2937; line-height: 1.72; padding: 36px 44px; }
    h1 { color: #0f3a5f; font-size: 28px; border-left: 5px solid #0f3a5f; padding-left: 14px; margin: 0 0 24px; }
    h2 { color: #0f3a5f; font-size: 20px; margin-top: 28px; }
    h3 { color: #334155; font-size: 16px; margin-top: 20px; }
    p { margin: 10px 0; }
    ul { margin: 10px 0 10px 24px; }
    .disclaimer { margin-top: 32px; padding: 14px 16px; background: #f8fafc; border-left: 4px solid #94a3b8; color: #475569; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${markdownishToHtml(body)}
  <div class="disclaimer">本报告由 AI 助手生成，仅用于数据研究与风险提示，不构成投资建议、买卖建议或收益承诺。投资有风险，决策需谨慎。</div>
</body>
</html>`;
}

function cleanupGeneratedArtifacts() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [key, value] of generatedArtifacts.entries()) {
    if (value.createdAt < cutoff) generatedArtifacts.delete(key);
  }
}

function attachGeneratedReportArtifacts(taskRun: TaskRunResult): TaskRunResult {
  if (taskRun.taskTemplateId !== "stock_ppt_report") return taskRun;
  const stageIndex = taskRun.stages.findIndex((stage) => stage.agentDefinitionId === "task-stock");
  if (stageIndex < 0) return taskRun;
  const stage = taskRun.stages[stageIndex];
  if (stage.status !== "success") return taskRun;
  const body = String(stage.runResult?.output || stage.runResult?.summary || "").trim();
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

  const stages = taskRun.stages.map((item, index) => index === stageIndex
    ? { ...item, artifacts: [...(item.artifacts || []), artifact] }
    : item);
  return {
    ...taskRun,
    stages,
    artifacts: [...(taskRun.artifacts || []), artifact],
  };
}

function attachGeneratedOfficeArtifacts(taskRun: TaskRunResult): TaskRunResult {
  if (!["market_research_brief", "meeting_prep_agent"].includes(taskRun.taskTemplateId)) return taskRun;
  if ((taskRun.artifacts || []).some((artifact) => artifact.metadata?.source === "sg-office-builder")) return taskRun;
  const writerIndex = taskRun.stages.findIndex((stage) => {
    const role = String(stage.runResult?.metadata?.role || stage.personaId || "").toLowerCase();
    return role === "writer" || /writer/.test(stage.agentDefinitionId) || /writer/.test(stage.stageId);
  });
  if (writerIndex < 0) return taskRun;
  const stage = taskRun.stages[writerIndex];
  if (stage.status !== "success") return taskRun;
  const body = String(stage.runResult?.output || stage.runResult?.summary || "").trim();
  if (!body) return taskRun;

  cleanupGeneratedArtifacts();
  const artifactType = String(stage.runResult?.metadata?.artifactType || taskRun.metadata?.artifactType || "docx");
  const officeKind = artifactType === "pptx" ? "pptx" : "docx";
  const extension = officeKind === "pptx" ? "ppt" : "doc";
  const mimeType = officeKind === "pptx" ? "application/vnd.ms-powerpoint" : "application/msword";
  const title = artifactFileStem(taskRun.taskTemplateId, officeKind);
  const key = `${taskRun.taskRunId}-${taskRun.taskTemplateId}-${officeKind}`;
  const html = buildWordCompatibleHtml(title, body);
  const fileName = `${title}.${extension}`;
  generatedArtifacts.set(key, {
    fileName,
    mimeType,
    body: html,
    createdAt: Date.now(),
  });

  const artifact: AgentArtifact = {
    id: key,
    type: "file",
    name: fileName,
    mimeType,
    previewUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}`,
    downloadUrl: `/api/admin/task-workbench-lab/generated-artifacts/${encodeURIComponent(key)}?download=1`,
    metadata: {
      source: "financial-harness-office-artifact",
      artifactType: officeKind,
      size: Buffer.byteLength(html, "utf8"),
    },
  };

  const stages = taskRun.stages.map((item, index) => index === writerIndex
    ? { ...item, artifacts: [...(item.artifacts || []), artifact] }
    : item);
  return {
    ...taskRun,
    stages,
    artifacts: [...(taskRun.artifacts || []), artifact],
  };
}

function attachTaskWorkbenchArtifacts(taskRun: TaskRunResult): TaskRunResult {
  return attachGeneratedOfficeArtifacts(attachGeneratedReportArtifacts(taskRun));
}

function writeSse(res: express.Response, type: string, payload: Record<string, unknown>) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(redactSecrets({ type, ...payload }))}\n\n`);
}

export function createTaskWorkbenchLabHandlers(options: {
  enabled?: () => boolean;
  authenticateUser?: (req: express.Request, res: express.Response) => Promise<LabUser | null>;
  createRunner?: (user: LabUser, callbacks?: RunnerCallbacks) => TaskTemplateRunner;
  routePrompt?: (input: { prompt: string; selectedTemplateId?: string | null; user: LabUser }) => Promise<TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }>;
} = {}) {
  async function authenticate(req: express.Request, res: express.Response) {
    if (!(options.enabled || isTaskWorkbenchLabEnabled)()) {
      res.status(404).json({ error: "not_found" });
      return null;
    }
    const user = await (options.authenticateUser || defaultAuthenticateUser)(req, res);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    const allowUserIds = parseAllowUserIds();
    if (allowUserIds.size > 0 && !allowUserIds.has(user.id)) {
      res.status(403).json({ error: "forbidden" });
      return null;
    }
    return user;
  }

  return {
    listTemplates: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const runner = options.createRunner ? options.createRunner(user) : createDefaultRunner(user);
      const ids = ["market_research_brief", "meeting_prep_agent", "ai_topic_insight_ppt"];
      const templates = [];
      for (const id of ids) {
        const result = await runner.loadTemplate(id);
        if (result.ok) templates.push(result.value);
      }
      return res.json({ templates: redactSecrets(templates), source: "task-workbench-lab" });
    },
    routePrompt: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = routeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
      }
      const decision = await (options.routePrompt || ((input) => routeTaskWorkbenchPrompt(input)))({
        prompt: parsed.data.prompt,
        selectedTemplateId: parsed.data.taskTemplateId || null,
        user,
      });
      return res.json({ decision: redactSecrets(decision), source: "task-workbench-lab" });
    },
    runTask: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = runBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
      }
      const runner = options.createRunner ? options.createRunner(user) : createDefaultRunner(user);
      const template = await runner.loadTemplate(parsed.data.taskTemplateId);
      if (!template.ok) {
        return res.status(unauthorizedStatus(template.error.kind)).json({ error: template.error.kind, detail: template.error.detail });
      }
      if (remoteHarnessExecutorEnabled()) {
        const remoteRun = await executeRemoteHarness({
          template: template.value,
          prompt: parsed.data.prompt,
          harnessPlan: parsed.data.harnessPlan,
        });
        if (remoteRun.ok) {
          return res.json({ taskRun: redactSecrets(attachTaskWorkbenchArtifacts(remoteRun.value)), source: "task-workbench-lab" });
        }
        console.warn("[TASK-WORKBENCH-LAB] remote harness executor fallback:", remoteRun.error.detail);
      }
      const run = await runner.runTask({
        template: template.value,
        userInput: parsed.data.prompt,
        context: {
          userId: user.id,
          adoptId: "task-workbench-lab",
          metadata: parsed.data.harnessPlan ? { harnessPlan: parsed.data.harnessPlan } : undefined,
        },
      });
      if (!run.ok) {
        return res.status(unauthorizedStatus(run.error.kind)).json({ error: run.error.kind, detail: run.error.detail });
      }
      return res.json({ taskRun: redactSecrets(attachTaskWorkbenchArtifacts(run.value)), source: "task-workbench-lab" });
    },
    runTaskStream: async (req: express.Request, res: express.Response) => {
      const user = await authenticate(req, res);
      if (!user) return;
      const parsed = runBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
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
          onTaskEvent: (event) => writeSse(res, event.type, { event }),
          onProviderEvent: (event) => writeSse(res, "agent_event", { event }),
        })
        : createDefaultRunner(user, {
          onTaskEvent: (event) => writeSse(res, event.type, { event }),
          onProviderEvent: (event) => writeSse(res, "agent_event", { event }),
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
        if (remoteHarnessExecutorEnabled()) {
          writeSse(res, "harness_executor_started", {
            harnessRunId: parsed.data.harnessPlan?.runId,
            templateId: parsed.data.harnessPlan?.templateId,
          });
          const remoteRun = await executeRemoteHarnessStream({
            template: template.value,
            prompt: parsed.data.prompt,
            harnessPlan: parsed.data.harnessPlan,
          }, {
            onStageStarted: (event) => writeSse(res, "stage_started", { event }),
            onStageDone: (stage) => writeSse(res, "stage_done", { event: { stage } }),
          });
          if (remoteRun.ok) {
            writeSse(res, "run_done", { taskRun: attachTaskWorkbenchArtifacts(remoteRun.value), source: "task-workbench-lab" });
            res.write("data: [DONE]\n\n");
            return res.end();
          }
          writeSse(res, "harness_executor_fallback", { error: remoteRun.error });
          console.warn("[TASK-WORKBENCH-LAB] remote harness executor fallback:", remoteRun.error.detail);
        }
        const run = await runner.runTask({
          template: template.value,
          userInput: parsed.data.prompt,
          context: {
            userId: user.id,
            adoptId: "task-workbench-lab",
            metadata: parsed.data.harnessPlan ? { harnessPlan: parsed.data.harnessPlan } : undefined,
          },
        });
        if (!run.ok) {
          writeSse(res, "run_failed", { error: run.error });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        writeSse(res, "run_done", { taskRun: attachTaskWorkbenchArtifacts(run.value), source: "task-workbench-lab" });
        res.write("data: [DONE]\n\n");
        return res.end();
      } catch (error: any) {
        writeSse(res, "run_failed", { error: { kind: "dispatch_failed", detail: error?.message || String(error) } });
        res.write("data: [DONE]\n\n");
        return res.end();
      } finally {
        clearInterval(heartbeat);
      }
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
      const body = artifact.body;
      const isTextBody = typeof body === "string";
      res.setHeader("content-type", isTextBody && !download ? "text/html; charset=utf-8" : artifact.mimeType);
      if (download) {
        res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
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
  app.get("/api/admin/task-workbench-lab/generated-artifacts/:key", handlers.generatedArtifact);
}
