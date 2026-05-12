import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  isBuiltinBusinessAgentAdapter,
  isReservedLegacyBusinessAgentId,
} from "@shared/business-agent-presets";
import {
  listBusinessAgents,
  listEnabledBusinessAgents,
  getBusinessAgent,
  upsertBusinessAgent,
  deleteBusinessAgent,
  updateBusinessAgentEnabled,
  insertCallLog,
  getCallLogs,
  getCallStats,
  updateAgentHealth,
  updateAgentFields,
} from "../db";
import { auditActor, auditRequest, recordAuditBestEffort } from "../_core/audit-events";

const providerTypes = [
  "openai-compatible",
  "openclaw-local",
  "openclaw-remote",
  "hermes",
  "http-sse",
  "mcp",
  "a2a",
] as const;

const adapterProtocols = [
  "openai-chat-completions",
  "openclaw-chat",
  "hermes-events",
  "stock-agent-v1",
  "my-wealth-hermes-v1",
  "bond-hermes-v1",
  "credit-risk-hermes-v1",
  "claim-ev-hermes-v1",
  "mcp-tools-v1",
  "a2a-task-v1",
] as const;

function inferProviderType(input: { id: string; kind?: string; providerType?: string | null }) {
  if (input.providerType) return input.providerType;
  if (input.id === "task-stock") return "http-sse";
  if (["task-hermes", "task-my-wealth", "task-bond", "task-credit-risk", "task-claim-ev"].includes(input.id)) return "hermes";
  if (input.kind === "local") return "openclaw-local";
  return "openai-compatible";
}

function inferAdapterProtocol(input: { id: string; kind?: string; adapterProtocol?: string | null }) {
  if (input.adapterProtocol) return input.adapterProtocol;
  if (input.id === "task-stock") return "stock-agent-v1";
  if (input.id === "task-my-wealth") return "my-wealth-hermes-v1";
  if (input.id === "task-bond") return "bond-hermes-v1";
  if (input.id === "task-credit-risk") return "credit-risk-hermes-v1";
  if (input.id === "task-claim-ev") return "claim-ev-hermes-v1";
  if (input.id === "task-hermes") return "hermes-events";
  if (input.kind === "local") return "openclaw-chat";
  return "openai-chat-completions";
}

function validateJsonField(label: string, raw: string | null | undefined, expect: "array" | "object") {
  if (!raw || !raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
  if (expect === "array" && !Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 数组`);
  if (expect === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
}

function assertProviderAdapterMatch(providerType: string, adapterProtocol: string) {
  if (providerType === "mcp" && adapterProtocol !== "mcp-tools-v1") {
    throw new Error("MCP 调用方式必须使用 mcp-tools-v1 适配器");
  }
  if (providerType === "a2a" && adapterProtocol !== "a2a-task-v1") {
    throw new Error("A2A 调用方式必须使用 a2a-task-v1 适配器");
  }
}

function builtinBusinessAgentPresetsEnabled() {
  return String(process.env.ENABLE_BUILTIN_BUSINESS_AGENT_PRESETS || "false").toLowerCase() === "true";
}

function assertBuiltinPresetAllowed(input: { id?: string | null; adapterProtocol?: string | null }) {
  if (builtinBusinessAgentPresetsEnabled()) return;
  if (isReservedLegacyBusinessAgentId(input.id)) {
    throw new Error("该智能体 ID 属于内置演示 Preset 保留名。开源/独立部署请使用自定义 ID，或显式开启 ENABLE_BUILTIN_BUSINESS_AGENT_PRESETS。");
  }
  if (isBuiltinBusinessAgentAdapter(input.adapterProtocol)) {
    throw new Error("该运行适配器属于内置演示 Preset。开源/独立部署请使用通用适配器，或显式开启 ENABLE_BUILTIN_BUSINESS_AGENT_PRESETS。");
  }
}

function parseJsonRecord(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function joinUrl(baseUrl: string, pathValue?: string) {
  if (!pathValue) return baseUrl;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = String(pathValue).replace(/^\//, "");
  return new URL(path, base).toString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const started = Date.now();
    const response = await fetch(url, { ...init, signal: ctrl.signal });
    return { response, latency: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function probeBusinessAgent(agent: any, timeoutMs: number) {
  const providerType = inferProviderType(agent);
  const endpointConfig = parseJsonRecord(agent.endpointConfigJson);
  const baseUrl = String(agent.apiUrl || "").replace(/\/$/, "");
  const headers: Record<string, string> = agent.apiToken ? { authorization: `Bearer ${agent.apiToken}` } : {};
  if (!baseUrl) return { status: "offline", message: "No API URL configured", latency: 0 };

  if (providerType === "mcp") {
    const url = joinUrl(baseUrl, endpointConfig.healthPath ?? endpointConfig.rpcPath ?? endpointConfig.path ?? "/mcp");
    const { response, latency } = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        ...headers,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: endpointConfig.protocolVersion || "2025-06-18",
          capabilities: {},
          clientInfo: { name: "lingxia-health-check", version: "1.0.0" },
        },
      }),
    }, timeoutMs);
    return { status: response.ok ? (latency > 5000 ? "degraded" : "healthy") : "degraded", message: `HTTP ${response.status}`, latency };
  }

  const defaultPath = providerType === "openai-compatible" || providerType === "openclaw-remote"
    ? "/v1/models"
    : providerType === "a2a"
      ? "/.well-known/agent-card.json"
      : "";
  const url = joinUrl(baseUrl, endpointConfig.healthPath ?? defaultPath);
  const { response, latency } = await fetchWithTimeout(url, { method: "GET", headers }, timeoutMs);
  return { status: response.ok ? (latency > 5000 ? "degraded" : "healthy") : "degraded", message: `HTTP ${response.status}`, latency };
}

export const agentHealthRouter = router({
    check: adminProcedure
      .input(z.object({ agentId: z.string() }))
      .mutation(async ({ input }) => {
        const agent = await getBusinessAgent(input.agentId);
        if (!agent || agent.kind !== "remote" || !agent.apiUrl) {
          await updateAgentHealth(input.agentId, "offline");
          return { status: "offline", message: "No API URL configured" };
        }
        try {
          const result = await probeBusinessAgent(agent, 10000);
          await updateAgentHealth(input.agentId, result.status as any);
          return result;
        } catch (e: any) {
          await updateAgentHealth(input.agentId, "offline");
          return { status: "offline", message: e?.message || "Connection failed" };
        }
      }),

    checkAll: adminProcedure.mutation(async () => {
      const agents = await listBusinessAgents();
      const results: Record<string, string> = {};
      for (const a of agents) {
        if (a.kind !== "remote" || !a.apiUrl) { results[a.id] = "skip"; continue; }
        try {
          const result = await probeBusinessAgent(a, 8000);
          const st = result.status;
          await updateAgentHealth(a.id, st);
          results[a.id] = st;
        } catch {
          await updateAgentHealth(a.id, "offline");
          results[a.id] = "offline";
        }
      }
      return results;
    }),

    logs: adminProcedure
      .input(z.object({ agentId: z.string(), limit: z.number().optional() }))
      .query(async ({ input }) => {
        return getCallLogs(input.agentId, input.limit || 50);
      }),

    stats: adminProcedure
      .input(z.object({ agentId: z.string() }))
      .query(async ({ input }) => {
        return getCallStats(input.agentId);
      }),

    updateFields: adminProcedure
      .input(z.object({
        id: z.string(),
        expiresAt: z.string().nullable().optional(),
        maxDailyRequests: z.number().optional(),
        allowedProfiles: z.string().optional(),
        tags: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...fields } = input;
        const updates: Record<string, any> = {};
        if (fields.expiresAt !== undefined) updates.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;
        if (fields.maxDailyRequests !== undefined) updates.maxDailyRequests = fields.maxDailyRequests;
        if (fields.allowedProfiles !== undefined) updates.allowedProfiles = fields.allowedProfiles;
        if (fields.tags !== undefined) updates.tags = fields.tags;
        if (Object.keys(updates).length > 0) await updateAgentFields(id, updates);
        return { ok: true };
      }),
});

export const bizAgentsRouter = router({
    list: adminProcedure.query(async () => {
      return listBusinessAgents();
    }),
    listEnabled: protectedProcedure.query(async () => {
      return listEnabledBusinessAgents();
    }),
    upsert: adminProcedure.input(z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(128),
      description: z.string().nullable().optional(),
      kind: z.enum(["local", "remote"]),
      apiUrl: z.string().nullable().optional(),
      apiToken: z.string().nullable().optional(),
      remoteAgentId: z.string().nullable().optional(),
      localAgentId: z.string().nullable().optional(),
      skills: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      enabled: z.number().int().optional(),
      sortOrder: z.number().int().optional(),
      expiresAt: z.string().nullable().optional(),
      maxDailyRequests: z.number().int().min(0).optional(),
      allowedProfiles: z.string().nullable().optional(),
      tags: z.string().nullable().optional(),
      systemPrompt: z.string().nullable().optional(),
      uiConfig: z.string().nullable().optional(),
      providerType: z.enum(providerTypes).nullable().optional(),
      adapterProtocol: z.enum(adapterProtocols).nullable().optional(),
      capabilitiesJson: z.string().nullable().optional(),
      endpointConfigJson: z.string().nullable().optional(),
    })).mutation(async ({ input, ctx }) => {
      const existing = await getBusinessAgent(input.id);
      const nextApiToken = input.apiToken && input.apiToken.trim()
        ? input.apiToken.trim()
        : (existing?.apiToken || null);
      const providerType = inferProviderType(input);
      const adapterProtocol = inferAdapterProtocol(input);
      validateJsonField("能力声明 JSON", input.capabilitiesJson, "array");
      validateJsonField("连接配置 JSON", input.endpointConfigJson, "object");
      assertProviderAdapterMatch(providerType, adapterProtocol);
      assertBuiltinPresetAllowed({ id: input.id, adapterProtocol });
      await upsertBusinessAgent({
        id: input.id,
        name: input.name,
        description: input.description || null,
        kind: input.kind,
        apiUrl: input.apiUrl || null,
        apiToken: nextApiToken,
        remoteAgentId: input.remoteAgentId || "main",
        localAgentId: input.localAgentId || null,
        skills: input.skills || null,
        icon: input.icon || "🤖",
        enabled: input.enabled ?? 1,
        sortOrder: input.sortOrder ?? 0,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxDailyRequests: input.maxDailyRequests ?? 0,
        allowedProfiles: input.allowedProfiles || "plus,internal",
        tags: input.tags || "",
        systemPrompt: input.systemPrompt || null,
        uiConfig: input.uiConfig || null,
        providerType,
        adapterProtocol,
        capabilitiesJson: input.capabilitiesJson || "[]",
        endpointConfigJson: input.endpointConfigJson || null,
      } as any);
      await recordAuditBestEffort({
        action: existing ? "agent.lifecycle.business_updated" : "agent.lifecycle.business_created",
        ...auditActor(ctx.user),
        ...auditRequest(ctx.req),
        targetType: "business_agent",
        targetId: input.id,
        targetName: input.name,
        runtimeType: providerType,
        runtimeAgentId: input.remoteAgentId || input.localAgentId || input.id,
        metadata: {
          kind: input.kind,
          enabled: input.enabled ?? 1,
          providerType,
          adapterProtocol,
          apiUrlPresent: Boolean(input.apiUrl),
          apiTokenUpdated: Boolean(input.apiToken && input.apiToken.trim()),
          capabilitiesJsonPresent: Boolean(input.capabilitiesJson),
          endpointConfigJsonPresent: Boolean(input.endpointConfigJson),
        },
      });
      return { ok: true };
    }),
    delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
      const existing = await getBusinessAgent(input.id);
      await deleteBusinessAgent(input.id);
      await recordAuditBestEffort({
        action: "agent.lifecycle.business_deleted",
        ...auditActor(ctx.user),
        ...auditRequest(ctx.req),
        targetType: "business_agent",
        targetId: input.id,
        targetName: existing?.name || null,
        runtimeType: existing?.providerType || null,
        runtimeAgentId: existing?.remoteAgentId || existing?.localAgentId || input.id,
        metadata: {
          kind: existing?.kind || null,
          priorEnabled: existing?.enabled ?? null,
        },
      });
      return { ok: true };
    }),
    setEnabled: adminProcedure.input(z.object({ id: z.string(), enabled: z.number().int() })).mutation(async ({ input, ctx }) => {
      if (input.enabled) {
        const existing = await getBusinessAgent(input.id);
        assertBuiltinPresetAllowed({
          id: input.id,
          adapterProtocol: existing?.adapterProtocol || inferAdapterProtocol({ id: input.id, kind: existing?.kind }),
        });
      }
      const existing = await getBusinessAgent(input.id);
      await updateBusinessAgentEnabled(input.id, input.enabled);
      await recordAuditBestEffort({
        action: input.enabled ? "agent.lifecycle.business_enabled" : "agent.lifecycle.business_disabled",
        ...auditActor(ctx.user),
        ...auditRequest(ctx.req),
        targetType: "business_agent",
        targetId: input.id,
        targetName: existing?.name || null,
        runtimeType: existing?.providerType || null,
        runtimeAgentId: existing?.remoteAgentId || existing?.localAgentId || input.id,
        metadata: {
          previousEnabled: existing?.enabled ?? null,
          enabled: input.enabled,
        },
      });
      return { ok: true };
    }),
});
