import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
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
          const start = Date.now();
          const baseUrl = agent.apiUrl.replace(/\/$/, "");
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const r = await fetch(`${baseUrl}/v1/models`, {
            headers: agent.apiToken ? { authorization: `Bearer ${agent.apiToken}` } : {},
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          const ms = Date.now() - start;
          if (r.ok) {
            await updateAgentHealth(input.agentId, ms > 5000 ? "degraded" : "healthy");
            return { status: ms > 5000 ? "degraded" : "healthy", latency: ms };
          } else {
            await updateAgentHealth(input.agentId, "degraded");
            return { status: "degraded", message: `HTTP ${r.status}`, latency: ms };
          }
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
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const baseUrl = String(a.apiUrl).replace(/\/$/, "");
          const r = await fetch(`${baseUrl}/v1/models`, {
            headers: a.apiToken ? { authorization: `Bearer ${a.apiToken}` } : {},
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          const st = r.ok ? "healthy" : "degraded";
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
      description: z.string().optional(),
      kind: z.enum(["local", "remote"]),
      apiUrl: z.string().optional(),
      apiToken: z.string().optional(),
      remoteAgentId: z.string().optional(),
      localAgentId: z.string().optional(),
      skills: z.string().optional(),
      icon: z.string().optional(),
      enabled: z.number().int().optional(),
      sortOrder: z.number().int().optional(),
      expiresAt: z.string().nullable().optional(),
      maxDailyRequests: z.number().int().min(0).optional(),
      allowedProfiles: z.string().optional(),
      tags: z.string().optional(),
      systemPrompt: z.string().optional(),
      uiConfig: z.string().optional(),
    })).mutation(async ({ input }) => {
      await upsertBusinessAgent({
        id: input.id,
        name: input.name,
        description: input.description || null,
        kind: input.kind,
        apiUrl: input.apiUrl || null,
        apiToken: input.apiToken || null,
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
      } as any);
      return { ok: true };
    }),
    delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      await deleteBusinessAgent(input.id);
      return { ok: true };
    }),
    setEnabled: adminProcedure.input(z.object({ id: z.string(), enabled: z.number().int() })).mutation(async ({ input }) => {
      await updateBusinessAgentEnabled(input.id, input.enabled);
      return { ok: true };
    }),
});
