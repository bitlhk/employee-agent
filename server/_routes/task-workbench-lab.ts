import express from "express";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AgentArtifact } from "../../shared/types/agent";
import type { TaskRunResult, TaskTemplateRunner } from "../../shared/types/task-template";
import { JsonTaskTemplateRunner, type TaskTemplateRunnerEvent } from "../_core/agent/task-template-runner";
import { JsonAgentRegistry } from "../_core/agent/agent-registry";
import { AdapterAgentClusterRunner } from "../_core/agent/agent-cluster-runner";
import { ClaudeCodeProvider } from "../_core/agent/providers/claude-code-provider";
import { HermesProvider } from "../_core/agent/providers/hermes-provider";
import { LegacyBusinessAgentResolver } from "../_core/agent/providers/legacy-business-agent-resolver";
import { StockAnalysisProvider } from "../_core/agent/providers/stock-analysis-provider";
import { redactSecrets } from "../_core/agent/providers/http-utils";
import type { ProviderStreamEvent } from "../_core/agent/providers/types";
import { routeTaskWorkbenchPrompt, type TaskWorkbenchRouterDecision } from "../_core/agent/task-workbench-router";
import { createContext } from "../_core/context";

type LabUser = { id: number; role: string };
let lastKillSwitchLogMs = 0;

type GeneratedArtifact = {
  fileName: string;
  html: string;
  createdAt: number;
};
const generatedArtifacts = new Map<string, GeneratedArtifact>();

const runBodySchema = z.object({
  taskTemplateId: z.string().min(1),
  prompt: z.string().min(1),
});

const routeBodySchema = z.object({
  taskTemplateId: z.string().min(1).optional(),
  prompt: z.string().min(1),
});

function isTaskWorkbenchLabEnabled() {
  const killFile = process.env.TASK_WORKBENCH_LAB_KILL_FILE
    || process.env.AGENT_CLUSTER_LAB_KILL_FILE
    || "/tmp/lingxia-agent-cluster-lab.disabled";
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
    maxAgents: Number(process.env.AGENT_CLUSTER_LAB_MAX_AGENTS || 3),
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
  generatedArtifacts.set(key, { fileName: reportFileName, html: reportHtml, createdAt: Date.now() });

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
      const ids = ["market_research_brief", "ai_topic_insight_ppt"];
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
      const run = await runner.runTask({
        template: template.value,
        userInput: parsed.data.prompt,
        context: { userId: user.id, adoptId: "task-workbench-lab" },
      });
      if (!run.ok) {
        return res.status(unauthorizedStatus(run.error.kind)).json({ error: run.error.kind, detail: run.error.detail });
      }
      return res.json({ taskRun: redactSecrets(attachGeneratedReportArtifacts(run.value)), source: "task-workbench-lab" });
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
      });

      try {
        const template = await runner.loadTemplate(parsed.data.taskTemplateId);
        if (!template.ok) {
          writeSse(res, "run_failed", { error: template.error });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        writeSse(res, "template_loaded", { template: template.value });
        const run = await runner.runTask({
          template: template.value,
          userInput: parsed.data.prompt,
          context: { userId: user.id, adoptId: "task-workbench-lab" },
        });
        if (!run.ok) {
          writeSse(res, "run_failed", { error: run.error });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        writeSse(res, "run_done", { taskRun: attachGeneratedReportArtifacts(run.value), source: "task-workbench-lab" });
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
      res.setHeader("content-type", download ? "application/msword; charset=utf-8" : "text/html; charset=utf-8");
      if (download) {
        res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
      }
      return res.send(artifact.html);
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
