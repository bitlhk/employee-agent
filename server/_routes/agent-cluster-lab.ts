import express from "express";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AgentClusterRunner } from "../../shared/types/agent";
import { JsonAgentRegistry } from "../_core/agent/agent-registry";
import { AdapterAgentClusterRunner } from "../_core/agent/agent-cluster-runner";
import { ClaudeCodeProvider } from "../_core/agent/providers/claude-code-provider";
import { HermesProvider } from "../_core/agent/providers/hermes-provider";
import { LegacyBusinessAgentResolver } from "../_core/agent/providers/legacy-business-agent-resolver";
import { StockAnalysisProvider } from "../_core/agent/providers/stock-analysis-provider";
import { redactSecrets } from "../_core/agent/providers/http-utils";
import { createContext } from "../_core/context";

type LabUser = { id: number; role: string };
let lastKillSwitchLogMs = 0;
const DEFAULT_LAB_AGENT_IDS = ["task-my-wealth", "task-ppt", "task-code", "task-stock"];

const runBodySchema = z.object({
  agentDefinitionIds: z.array(z.string().min(1)).min(1),
  prompt: z.string().min(1),
});

function isLabEnabled() {
  const killFile = process.env.AGENT_CLUSTER_LAB_KILL_FILE || "/tmp/lingxia-agent-cluster-lab.disabled";
  if (existsSync(killFile)) {
    const now = Date.now();
    if (now - lastKillSwitchLogMs > 60_000) {
      console.warn(`[AGENT-CLUSTER-LAB] disabled by kill file: ${killFile}`);
      lastKillSwitchLogMs = now;
    }
    return false;
  }
  return String(process.env.AGENT_CLUSTER_LAB_ENABLED || "false").toLowerCase() === "true";
}

function parseAllowUserIds() {
  return new Set(String(process.env.AGENT_CLUSTER_LAB_ALLOW_USER_IDS || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0));
}

function parseAllowAgentIds() {
  const raw = String(process.env.AGENT_CLUSTER_LAB_ALLOW_AGENT_IDS || "").trim();
  const source = raw ? raw.split(",") : DEFAULT_LAB_AGENT_IDS;
  return new Set(source.map((item) => item.trim()).filter(Boolean));
}

async function defaultAuthenticateUser(req: express.Request, res: express.Response): Promise<LabUser | null> {
  const ctx = await createContext({ req, res } as any);
  const user = ctx.user;
  return user ? { id: Number(user.id), role: String(user.role || "user") } : null;
}

export function createAgentClusterLabRunHandler(options: {
  enabled?: () => boolean;
  authenticateUser?: (req: express.Request, res: express.Response) => Promise<LabUser | null>;
  createRunner?: (user: LabUser) => AgentClusterRunner;
} = {}) {
  return async (req: express.Request, res: express.Response) => {
    if (!(options.enabled || isLabEnabled)()) {
      return res.status(404).json({ error: "not_found" });
    }

    const user = await (options.authenticateUser || defaultAuthenticateUser)(req, res);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (user.role !== "admin") return res.status(403).json({ error: "forbidden" });

    const allowUserIds = parseAllowUserIds();
    if (allowUserIds.size > 0 && !allowUserIds.has(user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const parsed = runBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
    }
    const allowAgentIds = parseAllowAgentIds();
    const deniedAgentIds = parsed.data.agentDefinitionIds.filter((id) => !allowAgentIds.has(id));
    if (deniedAgentIds.length > 0) {
      return res.status(400).json({
        error: "agent_not_allowed_in_lab",
        detail: `agent not allowed in lab: ${deniedAgentIds.join(",")}`,
      });
    }

    const runner = options.createRunner
      ? options.createRunner(user)
      : new AdapterAgentClusterRunner({
        userId: user.id,
        maxAgents: Number(process.env.AGENT_CLUSTER_LAB_MAX_AGENTS || 3),
        registry: new JsonAgentRegistry({
          resolveViewerContext: async (viewerUserId: number) => {
            const { getCoopProfile } = await import("../db/coop-identity");
            const profile = await getCoopProfile(viewerUserId);
            return { spaceId: profile.ok ? profile.value.spaceId : null };
          },
        }),
        createAdapter: (provider) => {
          if (provider.runtimeFamily === "hermes") return new HermesProvider(provider);
          if (provider.runtimeFamily === "claude-code") return new ClaudeCodeProvider(provider);
          if (provider.runtimeFamily === "lingxia-local") return new StockAnalysisProvider(provider);
          return null;
        },
        resolveBinding: ({ definition, provider }) => new LegacyBusinessAgentResolver().resolve(definition, provider),
      });

    const run = await runner.runCluster(null, {
      input: parsed.data.prompt,
      agentDefinitionIds: parsed.data.agentDefinitionIds,
      executionMode: "parallel-append",
    });
    if (!run.ok) {
      return res.status(run.error.kind === "unauthorized" ? 403 : 400).json({ error: run.error.kind, detail: run.error.detail });
    }

    const result = await runner.getRunResult(run.value.runId);
    if (!result.ok) {
      return res.status(500).json({ error: result.error.kind, detail: result.error.detail });
    }

    return res.json({ run: redactSecrets(result.value), source: "agent-cluster-lab" });
  };
}

export function registerAgentClusterLabRoutes(app: express.Express) {
  app.post("/api/admin/agent-cluster-lab/run", createAgentClusterLabRunHandler());
}
