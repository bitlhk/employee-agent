import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import {
  getCurrentClawByUserId,
  listClawsByUserId,
  getClawByAdoptId,
  createClawAdoption,
  updateClawAdoptionStatus,
  listClawAdoptionsAdmin,
  updateClawAdoptionAdmin,
  batchUpdateClawAdoptionAdmin,
  getClawAdoptionAdminById,
  deleteClawAdoptionAdmin,
  appendClawAdoptionEvent,
  getClawProfileSettings,
  upsertClawProfileSettings,
  getSystemConfigValue,
  getSystemConfigNumber,
  upsertSystemConfig,
  listSkillMarketItems,
  listApprovedSkillMarketItems,
  getSkillMarketItem,
  insertSkillMarketItem,
  updateSkillMarketItem,
  deleteSkillMarketItem,
  incrementSkillDownload,
  touchClawActivity,
  listBusinessAgentAudit,
  reverseTenantToken,
  getTenantAuditStats,
  getDb,
} from "../db";
import {
  APP_ROOT,
  OPENCLAW_HOME,
  OPENCLAW_JSON_PATH,
  clawDailyUsage,
  getAvailableClawModelsFromConfig,
  buildClawSessionKey,
  assertClawOwnerOrThrow,
  bumpClawSessionEpochBestEffort,
  applyClawSessionModelViaGatewayCommand,
  setAgentModelInOpenclawConfig,
  provisionEmployeeAgentInstance,
  writeClawExecAudit,
} from "./helpers";
import { hermesProfileSkillsDir, resolveRuntimeAgentId } from "../_core/helpers";
import { getAuditBaselineHealth } from "../_core/audit-health";
import { auditActor, auditErrorMetadata, auditRequest, recordAuditBestEffort, recordAuditRequired } from "../_core/audit-events";
import { onboardBuiltinSkillsForAdopt } from "../_core/skills/skill-onboarding";
import { skillRegistry } from "../_core/skills/skill-registry";
import { parseSkillSourceDirectory } from "../_core/skills/skill-source";
import { cleanupOpenClawWeixinBindingForAdopt } from "../_core/claw-weixin";
import type { SkillSource } from "../../shared/types/skill";

const openClawWorkspaceDir = (runtimeAgentId: string) => `${OPENCLAW_HOME}/workspace-${String(runtimeAgentId || "").trim()}`;
const openClawAgentStateDir = (runtimeAgentId: string) => `${OPENCLAW_HOME}/agents/${String(runtimeAgentId || "").trim()}`;
const openClawSkillMarketDir = () => `${OPENCLAW_HOME}/skill-market`;
const openClawSharedSkillsDir = () => `${OPENCLAW_HOME}/skills-shared`;

function safeExec(command: string, timeout = 8000): { ok: boolean; output: string; error?: string } {
  try {
    return {
      ok: true,
      output: execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim(),
    };
  } catch (e: any) {
    return {
      ok: false,
      output: String(e?.stdout || "").trim(),
      error: String(e?.stderr || e?.message || e).trim(),
    };
  }
}

function safeJson<T = any>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function redactHealthValue(value: any): any {
  if (Array.isArray(value)) return value.map(redactHealthValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, any> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|secret|password|apiKey|cookie/i.test(key)) out[key] = "***";
    else out[key] = redactHealthValue(raw);
  }
  return out;
}

function pruneSkillRegistryForAdopt(adoptId: string): number {
  const registryPath = `${APP_ROOT}/data/skill-registry.json`;
  try {
    if (!existsSync(registryPath)) return 0;
    const rows = JSON.parse(String(readFileSync(registryPath, "utf-8") || "[]"));
    if (!Array.isArray(rows)) return 0;
    const next = rows.filter((row: any) => String(row?.adoptId || "") !== adoptId);
    if (next.length === rows.length) return 0;
    writeFileSync(registryPath, JSON.stringify(next, null, 2), "utf-8");
    return rows.length - next.length;
  } catch (e: any) {
    console.warn("[ADMIN-DELETE-CLAW] failed to prune skill registry", { adoptId, error: String(e?.message || e) });
    return 0;
  }
}

function pruneOpenClawAgentConfig(agentIds: string[]): boolean {
  try {
    if (!existsSync(OPENCLAW_JSON_PATH)) return false;
    const config = JSON.parse(String(readFileSync(OPENCLAW_JSON_PATH, "utf-8") || "{}"));
    const list = Array.isArray(config?.agents?.list) ? config.agents.list : null;
    if (!list) return false;
    const idSet = new Set(agentIds.map((id) => String(id || "").trim()).filter(Boolean));
    const next = list.filter((entry: any) => !idSet.has(String(entry?.id || "")));
    if (next.length === list.length) return false;
    config.agents.list = next;
    writeFileSync(OPENCLAW_JSON_PATH, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch (e: any) {
    console.warn("[ADMIN-DELETE-CLAW] failed to prune openclaw config", { agentIds, error: String(e?.message || e) });
    return false;
  }
}

export const clawRouter = router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.user!.id;
      const all = await listClawsByUserId(userId);

      const normalizeEntry = (c: any) => ({
        ...c,
        entryUrl: String(c?.entryUrl || "")
          .replace("http://", "https://")
          .replace(".demo.linggantest.top", ".demo.linggan.top"),
        runtime: String(c?.adoptId || "").startsWith("lgh-") ? "hermes" : "openclaw",
      });

      const adoptions = all.map(normalizeEntry);
      // 向后兼容：老前端读 adoption 取第一张（sort 保证 lgc-* 在前，行为跟 getCurrentClawByUserId 一致）
      const primary = adoptions[0] || null;

      return {
        hasClaw: adoptions.length > 0,
        adoption: primary,  // 保留老字段供未升级前端使用
        adoptions,          // 新字段，多 runtime 场景
      };
    }),

    getByAdoptId: publicProcedure
      .input(z.object({ adoptId: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) return null;
        const profile = await getClawProfileSettings(Number((claw as any).id || 0));
        return {
          adoptId: claw.adoptId,
          status: claw.status,
          entryUrl: claw.entryUrl,
          expiresAt: claw.expiresAt,
          displayName: String((profile as any)?.displayName || "员工智能体"),
          permissionProfile: String(claw.permissionProfile || "starter"),
        };
      }),

    publicConfig: publicProcedure.query(async () => {
      const visibility = (await getSystemConfigValue("claw_visibility", "internal")).trim() || "internal";
      return { visibility: visibility === "internal" ? "internal" : "public" };
    }),

    getAvailableModels: publicProcedure.query(() => {
      return getAvailableClawModelsFromConfig();
    }),

    switchModel: protectedProcedure
      .input(z.object({ adoptId: z.string().min(1).max(64), modelId: z.string().min(1).max(120) }))
      .mutation(async ({ input, ctx }) => {
        const allowed = new Set(getAvailableClawModelsFromConfig().map((m) => m.id));
        if (!allowed.has(input.modelId)) {
          throw new Error("不支持的模型");
        }

        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        if (Number(claw.userId) !== Number(ctx.user!.id)) {
          throw new Error("无权修改该智能体设置");
        }
        const previousModel = String((claw as any).model || "");

        // 1) 保存到业务设置（用于页面回显）
        await upsertClawProfileSettings(Number(claw.id), {
          model: input.modelId,
          updatedBy: ctx.user!.id,
        } as any);

        // 2) 通过 OpenClaw 会话命令即时切换（不重启 gateway）
        const sessionKey = buildClawSessionKey(String((claw as any).adoptId || input.adoptId), Number((claw as any).userId || 0));
        const applied = await applyClawSessionModelViaGatewayCommand({
          agentId: String((claw as any).agentId || ""),
          sessionKey,
          modelId: input.modelId,
        });

        // 2.5) 持久化到 openclaw.json agents.list[].model —— gateway 热加载后路由才真正切过来
        const cfgApplied = setAgentModelInOpenclawConfig(String((claw as any).agentId || ""), input.modelId);
        if (!cfgApplied.ok) {
          throw new Error(`模型切换持久化失败（${cfgApplied.error}）。当前会话已临时生效，但重启或热加载后会回退到原模型。`);
        }

        // 2.6) 持久化到 claw-model-overrides.json —— 刷新后下拉能记住用户选择
        try {
          const { readFileSync, writeFileSync, existsSync } = await import("fs");
          const op = APP_ROOT + "/data/claw-model-overrides.json";
          let obj: any = {};
          if (existsSync(op)) { try { obj = JSON.parse(readFileSync(op, "utf8") || "{}"); } catch {} }
          obj[input.adoptId] = input.modelId;
          writeFileSync(op, JSON.stringify(obj, null, 2), "utf8");
        } catch (e) { console.warn("[switchModel] overrides persist failed:", e); }

        await recordAuditBestEffort({
          action: "model.switched",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "agent",
          targetId: input.adoptId,
          targetName: String((claw as any).agentId || input.adoptId),
          agentInstanceId: input.adoptId,
          runtimeType: String(input.adoptId).startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId: String((claw as any).agentId || ""),
          metadata: {
            previousModel: previousModel || null,
            model: input.modelId,
            applied: applied.ok,
            statusCode: applied.statusCode || null,
            persistedToConfig: cfgApplied.ok,
          },
        });

        return {
          ok: true,
          model: input.modelId,
          applied: applied.ok,
          statusCode: applied.statusCode || null,
          applyError: applied.ok ? null : applied.error || applied.respText || null,
        };
      }),

    adminList: adminProcedure
      .input(z.object({ keyword: z.string().optional(), status: z.enum(["all", "creating", "active", "expiring", "recycled", "failed"]).optional() }).optional())
      .query(async ({ input }) => {
        const rows = await listClawAdoptionsAdmin({ keyword: input?.keyword, status: input?.status || "all", limit: 300 });
        const summary = {
          total: rows.length,
          creating: rows.filter((r) => r.status === "creating").length,
          active: rows.filter((r) => r.status === "active").length,
          expiring: rows.filter((r) => r.status === "expiring").length,
          recycled: rows.filter((r) => r.status === "recycled").length,
          failed: rows.filter((r) => r.status === "failed").length,
        };
        return { summary, rows };
      }),

    adminUpdate: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        permissionProfile: z.enum(["starter", "plus", "internal"]).optional(),
        ttlDays: z.number().int().min(0).max(365).optional(),
        status: z.enum(["creating", "active", "expiring", "recycled", "failed"]).optional(),
        expiresAt: z.string().datetime().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const before = await getClawAdoptionAdminById(input.id);
        await updateClawAdoptionAdmin(input.id, {
          permissionProfile: input.permissionProfile as any,
          ttlDays: input.ttlDays,
          status: input.status as any,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        });
        await recordAuditBestEffort({
          action: "agent.lifecycle.admin_updated",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "agent",
          targetId: before?.adoptId ? String(before.adoptId) : String(input.id),
          targetName: before?.agentId ? String(before.agentId) : null,
          agentInstanceId: before?.adoptId ? String(before.adoptId) : null,
          runtimeType: before?.adoptId && String(before.adoptId).startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId: before?.agentId ? String(before.agentId) : null,
          metadata: {
            id: input.id,
            permissionProfile: input.permissionProfile || null,
            ttlDays: input.ttlDays ?? null,
            status: input.status || null,
            expiresAt: input.expiresAt || null,
          },
        });
        return { ok: true };
      }),

    adminBatchUpdate: adminProcedure
      .input(z.object({
        ids: z.array(z.number().int().positive()).min(1),
        permissionProfile: z.enum(["starter", "plus", "internal"]).optional(),
        ttlDays: z.number().int().min(0).max(365).optional(),
        status: z.enum(["creating", "active", "expiring", "recycled", "failed"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await recordAuditBestEffort({
          action: "agent.lifecycle.batch_admin_updated",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "agent_batch",
          targetId: input.ids.join(","),
          metadata: {
            count: input.ids.length,
            permissionProfile: input.permissionProfile || null,
            ttlDays: input.ttlDays ?? null,
            status: input.status || null,
          },
        });
        await batchUpdateClawAdoptionAdmin(input.ids, {
          permissionProfile: input.permissionProfile as any,
          ttlDays: input.ttlDays,
          status: input.status as any,
        });
        return { ok: true, count: input.ids.length };
      }),

    adminDelete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const row = await getClawAdoptionAdminById(input.id);
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "智能体不存在" });
        }
        if (!["recycled", "failed"].includes(String(row.status))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "请先停用智能体，再执行删除" });
        }

        const adoptId = String(row.adoptId || "");
        const runtimeAgentId = resolveRuntimeAgentId(adoptId, String(row.agentId || ""));
        const workspacePath = openClawWorkspaceDir(runtimeAgentId);
        const agentStatePath = openClawAgentStateDir(runtimeAgentId);
        const skillsRemoved = pruneSkillRegistryForAdopt(adoptId);
        const configPruned = pruneOpenClawAgentConfig([String(row.agentId || ""), runtimeAgentId, `trial_${adoptId}`]);
        const weixinCleanup = cleanupOpenClawWeixinBindingForAdopt(adoptId, row);

        try {
          if (existsSync(workspacePath)) rmSync(workspacePath, { recursive: true, force: true });
        } catch (e: any) {
          console.warn("[ADMIN-DELETE-CLAW] failed to remove workspace", { adoptId, workspacePath, error: String(e?.message || e) });
        }
        try {
          if (existsSync(agentStatePath)) rmSync(agentStatePath, { recursive: true, force: true });
        } catch (e: any) {
          console.warn("[ADMIN-DELETE-CLAW] failed to remove agent state", { adoptId, agentStatePath, error: String(e?.message || e) });
        }

        const deleted = await deleteClawAdoptionAdmin(input.id);
        bumpClawSessionEpochBestEffort(adoptId);
        await recordAuditBestEffort({
          action: "agent.lifecycle.deleted",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "agent",
          targetId: adoptId,
          targetName: String(row.agentId || ""),
          agentInstanceId: adoptId,
          runtimeType: adoptId.startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId,
          metadata: {
            id: input.id,
            priorStatus: row.status,
            workspaceRemoved: !existsSync(workspacePath),
            agentStateRemoved: !existsSync(agentStatePath),
            skillsRemoved,
            configPruned,
            weixinCleanup: {
              removed: Boolean(weixinCleanup?.removed),
              accountIdPresent: Boolean(weixinCleanup?.accountId),
              userIdPresent: Boolean(weixinCleanup?.userId),
            },
          },
        });
        writeClawExecAudit({
          adoptId,
          agentId: String(row.agentId || ""),
          userId: ctx.user?.id ?? null,
          permissionProfile: String(row.permissionProfile || ""),
          message: "admin_delete_claw",
          ok: true,
          meta: {
            id: input.id,
            runtimeAgentId,
            status: row.status,
            workspaceRemoved: !existsSync(workspacePath),
            agentStateRemoved: !existsSync(agentStatePath),
            skillsRemoved,
            configPruned,
            weixinCleanup,
          },
        });

        return {
          ok: true,
          deleted: {
            id: deleted.id,
            adoptId: deleted.adoptId,
            agentId: deleted.agentId,
            status: deleted.status,
          },
          cleanup: {
            workspacePath,
            workspaceRemoved: !existsSync(workspacePath),
            agentStatePath,
            agentStateRemoved: !existsSync(agentStatePath),
            skillsRemoved,
            configPruned,
            weixinCleanup,
          },
        };
      }),

    // ── Hermes runtime 专属虾 provisioning（admin 手动发放） ──
    // 灰度期给指定用户开一张 lgh-* 虾，跑本机 Hermes profile。
    // 内部调 /root/linggan-platform/scripts/provision-hermes-claw.sh
    // 脚本做：创 profile + 分配端口 + 启 systemd + INSERT claw_adoptions
    adminProvisionHermesClaw: adminProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        // Regex 严格限死 profileName 字符范围，execFileSync 再兜底不走 shell
        profileName: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
      }))
      .mutation(async ({ input }) => {
        const { execFileSync } = await import("child_process");
        const scriptPath = `${APP_ROOT}/scripts/provision-hermes-claw.sh`;
        if (!existsSync(scriptPath)) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "provisioning script not found" });
        }
        try {
          const out = execFileSync(
            "bash",
            [scriptPath, input.profileName, String(input.userId)],
            { encoding: "utf8", timeout: 60_000 },
          );
          return {
            ok: true,
            adoptId: `lgh-${input.profileName}`,
            log: out.slice(-2000),
          };
        } catch (err: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `provisioning failed: ${String(err?.stdout || err?.stderr || err?.message || err).slice(0, 500)}`,
          });
        }
      }),

    // ── 技能市场管理 ──

    // 管理员列表（从 DB + 文件系统）
    adminListMarketSkills: adminProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return listSkillMarketItems(input?.status);
      }),

    adminSystemHealth: adminProcedure.query(async () => {
      const checkedAt = new Date().toISOString();
      const health = safeExec("curl -fsS http://127.0.0.1:5180/health", 5000);
      const pm2 = safeExec("pm2 jlist", 8000);
      const openclawStatus = safeExec("openclaw status --json", 12000);
      const channelStatus = safeExec("openclaw channels status --deep", 12000);
      const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD", 5000);
      const gitCommit = safeExec("git rev-parse --short HEAD", 5000);
      const openclawProcesses = safeExec("pgrep -af '^openclaw( |$)'", 5000);

      const pm2Rows = pm2.ok ? safeJson<any[]>(pm2.output || "[]", []) : [];
      const appName = process.env.PM2_APP_NAME || (APP_ROOT.includes("linggan-platform") ? "linggan-claw" : "employee-agent");
      const app = Array.isArray(pm2Rows)
        ? pm2Rows.find((row) => String(row?.name || "") === appName) || pm2Rows.find((row) => /employee-agent|linggan-claw/.test(String(row?.name || "")))
        : null;

      const openclawJson = openclawStatus.ok ? safeJson<any>(openclawStatus.output, null) : null;
      const config = existsSync(OPENCLAW_JSON_PATH) ? safeJson<any>(String(readFileSync(OPENCLAW_JSON_PATH, "utf8") || "{}"), {}) : {};
      const allowlist = Object.keys(config?.agents?.defaults?.models || {});
      const primary = String(config?.agents?.defaults?.model?.primary || "");
      const agentModelDrift = (Array.isArray(config?.agents?.list) ? config.agents.list : [])
        .map((agent: any) => {
          const model = typeof agent?.model === "string" ? agent.model : String(agent?.model?.primary || "");
          return { id: String(agent?.id || ""), model };
        })
        .filter((agent: any) => agent.model && allowlist.length > 0 && !allowlist.includes(agent.model));

      const dbTables = ["users", "business_agent_audit", "business_agent_tenant_map", "skill_marketplace"];
      const dbHealth: any = { ok: false, tables: [] as any[], skillMarketApproved: null, claws: null, error: "" };
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        dbHealth.ok = true;
        for (const table of dbTables) {
          const result: any = await db.execute(`SHOW TABLES LIKE '${table.replace(/'/g, "")}'`);
          const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
          dbHealth.tables.push({ name: table, exists: rows.length > 0 });
        }
        const approved: any = await db.execute("SELECT COUNT(*) AS count FROM skill_marketplace WHERE status = 'approved'");
        const claws: any = await db.execute("SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM claw_adoptions");
        dbHealth.skillMarketApproved = Number((approved?.[0]?.[0] || approved?.[0] || {}).count || 0);
        const clawRow = claws?.[0]?.[0] || claws?.[0] || {};
        dbHealth.claws = { total: Number(clawRow.total || 0), active: Number(clawRow.active || 0) };
      } catch (e: any) {
        dbHealth.error = String(e?.message || e);
      }

      const auditBaseline = await getAuditBaselineHealth();

      const channelLines = channelStatus.output.split(/\r?\n/).filter((line) => line.trim().startsWith("- "));
      const channels = channelLines.map((line) => ({
        raw: line.replace(/^\-\s*/, ""),
        ok: /\brunning\b/.test(line) && !/\bstopped\b|\berror:/i.test(line),
        warn: /\bdisconnected\b|degraded|timed out/i.test(line),
      }));

      const processLines = openclawProcesses.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

      return redactHealthValue({
        checkedAt,
        app: {
          name: appName,
          healthOk: health.ok,
          health: health.ok ? safeJson(health.output, { raw: health.output }) : null,
          pm2: app ? {
            name: app.name,
            status: app.pm2_env?.status,
            restarts: app.pm2_env?.restart_time,
            uptime: app.pm2_env?.pm_uptime,
            memory: app.monit?.memory,
            cpu: app.monit?.cpu,
          } : null,
          git: { branch: gitBranch.output || "", commit: gitCommit.output || "" },
          errors: [health.error, pm2.error].filter(Boolean),
        },
        openclaw: {
          reachable: Boolean(openclawJson?.gateway?.reachable),
          version: openclawJson?.runtimeVersion || "",
          gateway: openclawJson?.gateway || null,
          service: openclawJson?.gatewayService?.runtimeShort || openclawJson?.gatewayService || null,
          processCount: processLines.length,
          processes: processLines,
          errors: [openclawStatus.error, openclawProcesses.error].filter(Boolean),
        },
        channels: {
          ok: channelStatus.ok,
          lines: channels,
          raw: channelStatus.output,
          error: channelStatus.error || "",
        },
        models: {
          primary,
          allowlist,
          agentModelDrift,
        },
        database: dbHealth,
        audit: auditBaseline,
      });
    }),

    // 管理员上传技能包（zip）— 通过 Express 路由处理，这里只做元数据入库
    adminPublishSkill: adminProcedure
      .input(z.object({
        skillId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        author: z.string().optional(),
        version: z.string().optional(),
        category: z.enum(["finance", "dev", "data", "writing", "general"]).optional(),
        origin: z.enum(["opensource", "squad"]).optional(),
        license: z.string().optional(),
        status: z.enum(["pending", "approved", "rejected", "offline"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const marketDir = openClawSkillMarketDir();
        const status = input.status || "approved";
        const id = await insertSkillMarketItem({
          skillId: input.skillId,
          name: input.name,
          description: input.description || null,
          author: input.author || "官方",
          authorUserId: ctx.user!.id,
          version: input.version || "1.0.0",
          category: input.category || "general",
          origin: input.origin || "opensource",
          status,
          license: input.license || "MIT",
          packagePath: `${marketDir}/${status}/${input.skillId}`,
        });
        await recordAuditBestEffort({
          action: "skill.market.created",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: input.skillId,
          targetName: input.name,
          metadata: {
            marketId: id,
            status,
            category: input.category || "general",
            origin: input.origin || "opensource",
            version: input.version || "1.0.0",
          },
        });
        return { ok: true, id };
      }),

    // 审核（通过/拒绝/下架）— 同时移动文件目录
    adminReviewSkill: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["approved", "rejected", "offline"]),
        reviewNote: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const item = await getSkillMarketItem(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.status === "approved") {
          await recordAuditRequired({
            action: "skill.market.approved.requested",
            ...auditActor(ctx.user),
            ...auditRequest(ctx.req),
            targetType: "skill",
            targetId: String(item.skillId || item.id),
            targetName: item.name || null,
            metadata: {
              marketId: input.id,
              previousStatus: item.status || null,
              reviewNotePresent: Boolean(input.reviewNote),
            },
          });
        }
        try {
          const marketDir = openClawSkillMarketDir();
          const { execSync } = await import("child_process");
          const oldDir = item.packagePath || `${marketDir}/${item.status}/${item.skillId}`;
          const newDir = `${marketDir}/${input.status}/${item.skillId}-${item.id}`;
          if (oldDir !== newDir) {
            try {
              execSync(`mkdir -p ${newDir} && cp -r ${oldDir}/* ${newDir}/ 2>/dev/null; rm -rf ${oldDir}`, { stdio: "ignore" });
            } catch {}
          }
          if (input.status === "approved") {
            const origin = String((item as any).origin || "opensource");
            const approvedRows = await listSkillMarketItems("approved");
            for (const row of approvedRows) {
              if (Number(row.id) === Number(item.id)) continue;
              if (String(row.skillId) !== String(item.skillId)) continue;
              if (String((row as any).origin || "opensource") !== origin) continue;
              await updateSkillMarketItem(Number(row.id), { status: "offline" });
            }
          }
          await updateSkillMarketItem(input.id, {
            status: input.status,
            reviewNote: input.reviewNote || null,
            packagePath: newDir,
          });
          if (input.status === "approved") {
            await recordAuditRequired({
              action: "skill.market.approved.completed",
              ...auditActor(ctx.user),
              ...auditRequest(ctx.req),
              targetType: "skill",
              targetId: String(item.skillId || item.id),
              targetName: item.name || null,
              metadata: {
                marketId: input.id,
                previousStatus: item.status || null,
                status: input.status,
                reviewNotePresent: Boolean(input.reviewNote),
              },
            });
          } else {
            await recordAuditBestEffort({
              action: "skill.market.reviewed",
              ...auditActor(ctx.user),
              ...auditRequest(ctx.req),
              targetType: "skill",
              targetId: String(item.skillId || item.id),
              targetName: item.name || null,
              metadata: {
                marketId: input.id,
                previousStatus: item.status || null,
                status: input.status,
                reviewNotePresent: Boolean(input.reviewNote),
              },
            });
          }
        } catch (error) {
          if (input.status === "approved") {
            await recordAuditBestEffort({
              action: "skill.market.approved.failed",
              result: "failed",
              severity: "high",
              ...auditActor(ctx.user),
              ...auditRequest(ctx.req),
              targetType: "skill",
              targetId: String(item.skillId || item.id),
              targetName: item.name || null,
              errorCode: "SKILL_MARKET_APPROVAL_FAILED",
              metadata: {
                marketId: input.id,
                previousStatus: item.status || null,
                reviewNotePresent: Boolean(input.reviewNote),
                ...auditErrorMetadata(error),
              },
            });
          }
          throw error;
        }
        return { ok: true };
      }),

    // 查看技能源码（SKILL.md + 文本源码文件）
    adminViewSkillSource: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const item = await getSkillMarketItem(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        const { readFileSync, readdirSync, existsSync, statSync } = await import("fs");
        const { join } = await import("path");
        const dir = item.packagePath || "";
        let skillMd = "";
        let scripts: string[] = [];
        const sourceFiles: Array<{ path: string; content: string; size: number; truncated: boolean }> = [];
        const skippedDirs = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"]);
        const allowedSuffixes = [
          ".md",
          ".txt",
          ".py",
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
          ".json",
          ".yaml",
          ".yml",
          ".sh",
          ".sql",
          ".xml",
          ".toml",
          ".ini",
          ".template",
        ];
        const maxFiles = 40;
        const maxBytes = 120 * 1024;
        const isViewableSource = (relativePath: string) => {
          const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
          if (normalized === "skill.md") return false;
          if (/(^|\/)(\.env|secrets?|credentials?|tokens?|passwords?)(\.|\/|$)/.test(normalized)) return false;
          if (/\.(pem|key|p12|pfx|crt|cer|der|sqlite|db|zip|tar|gz|png|jpg|jpeg|gif|webp|pdf|docx|xlsx)$/i.test(normalized)) return false;
          return allowedSuffixes.some((suffix) => normalized.endsWith(suffix));
        };
        const collectSourceFiles = (currentDir: string, prefix = "") => {
          if (sourceFiles.length >= maxFiles) return;
          let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
          try {
            entries = readdirSync(currentDir, { withFileTypes: true }) as any;
          } catch {
            return;
          }
          for (const entry of entries) {
            if (sourceFiles.length >= maxFiles) break;
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const fullPath = join(currentDir, entry.name);
            if (entry.isDirectory()) {
              if (!skippedDirs.has(entry.name)) collectSourceFiles(fullPath, relativePath);
              continue;
            }
            if (!entry.isFile() || !isViewableSource(relativePath)) continue;
            try {
              const stat = statSync(fullPath);
              const tooLarge = stat.size > maxBytes;
              const content = tooLarge
                ? `文件大小 ${stat.size} bytes，超过源码预览上限 ${maxBytes} bytes。`
                : readFileSync(fullPath, "utf8");
              if (!tooLarge && content.includes("\u0000")) continue;
              sourceFiles.push({
                path: relativePath.replace(/\\/g, "/"),
                content,
                size: stat.size,
                truncated: tooLarge,
              });
            } catch {}
          }
        };
        try { skillMd = readFileSync(`${dir}/SKILL.md`, "utf8"); } catch {}
        try { if (existsSync(`${dir}/scripts`)) scripts = readdirSync(`${dir}/scripts`); } catch {}
        if (dir) collectSourceFiles(dir);
        sourceFiles.sort((a, b) => {
          const aRank = a.path.startsWith("scripts/") ? 0 : a.path.startsWith("templates/") ? 1 : a.path.startsWith("reference/") ? 2 : 3;
          const bRank = b.path.startsWith("scripts/") ? 0 : b.path.startsWith("templates/") ? 1 : b.path.startsWith("reference/") ? 2 : 3;
          return aRank - bRank || a.path.localeCompare(b.path);
        });
        return { skillMd, scripts, sourceFiles, dir };
      }),

    // 删除
    adminDeleteMarketSkill: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const item = await getSkillMarketItem(input.id);
        if (item?.packagePath) {
          const { execSync } = await import("child_process");
          try { execSync(`rm -rf ${item.packagePath}`, { stdio: "ignore" }); } catch {}
        }
        await deleteSkillMarketItem(input.id);
        await recordAuditBestEffort({
          action: "skill.market.deleted",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: String(item?.skillId || input.id),
          targetName: item?.name || null,
          metadata: {
            marketId: input.id,
            priorStatus: item?.status || null,
            packagePathPresent: Boolean(item?.packagePath),
          },
        });
        return { ok: true };
      }),

    // 用户端浏览已上架技能
    marketList: publicProcedure.query(async () => {
      return listApprovedSkillMarketItems();
    }),

    // 用户安装（复制到 workspace/skills/）
    marketInstall: protectedProcedure
      .input(z.object({ marketId: z.number(), adoptId: z.string().min(1).max(64) }))
      .mutation(async ({ input, ctx }) => {
        // Hermes runtime 虾（lgh-*）的技能由 Hermes 自动管理，不支持手动安装市场技能。
        // 相关 cp 路径对 Hermes 无效，前端也应该隐藏安装按钮；这里做硬拦截防止走到后面制造脏目录。
        if (String(input.adoptId).startsWith("lgh-")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Hermes 虾的技能由 Hermes 自动管理，暂不支持手动安装市场技能。请在 OpenClaw 虾中使用此功能。",
          });
        }
        const item = await getSkillMarketItem(input.marketId);
        if (!item || item.status !== "approved") throw new TRPCError({ code: "NOT_FOUND", message: "技能不存在或未上架" });
        await assertClawOwnerOrThrow(ctx, input.adoptId);
        const claw = await getClawByAdoptId(input.adoptId);
        if (!item.packagePath || !existsSync(item.packagePath)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "技能包源不存在" });
        }

        const parsed = parseSkillSourceDirectory(item.packagePath, item.skillId || item.name || "market-skill");
        const source: SkillSource = {
          kind: "marketplace",
          skillId: parsed.skillId || item.skillId,
          displayName: item.name || parsed.displayName || item.skillId,
          description: item.description || parsed.description || "",
          sourcePath: item.packagePath,
          marketplaceId: String(item.id),
          version: String(item.version || parsed.manifest?.version || "1.0.0"),
        };
        const installed = await skillRegistry.install(input.adoptId, source);
        if (!installed.ok) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: installed.error.detail });
        }
        await skillRegistry.updateScan(input.adoptId, source.skillId, {
          warnings: parsed.warnings,
          scannedAt: new Date().toISOString(),
        });
        await incrementSkillDownload(input.marketId);
        await recordAuditBestEffort({
          action: "skill.installed",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: source.skillId,
          targetName: source.displayName,
          resourceType: "agent",
          resourceId: input.adoptId,
          agentInstanceId: input.adoptId,
          runtimeType: "openclaw",
          runtimeAgentId: String(claw?.agentId || ""),
          metadata: {
            marketplaceId: input.marketId,
            version: source.version,
            warningCount: parsed.warnings.length,
          },
        });
        return { ok: true, skillId: source.skillId, name: source.displayName, item: installed.value, warnings: parsed.warnings };
      }),

        adminListSharedSkills: adminProcedure.query(async () => {
      const sharedDir = openClawSharedSkillsDir();
      const { readdirSync, readFileSync, existsSync, statSync } = await import("fs");
      const skills: Array<{ id: string; name: string; description: string; hasScripts: boolean }> = [];
      try {
        const dirs = readdirSync(sharedDir).filter(d => statSync(`${sharedDir}/${d}`).isDirectory());
        for (const id of dirs) {
          let name = id;
          let description = "";
          let hasScripts = existsSync(`${sharedDir}/${id}/scripts`);
          try {
            const md = readFileSync(`${sharedDir}/${id}/SKILL.md`, "utf8");
            const fm = md.match(/^---\n([\s\S]*?)\n---/);
            if (fm) {
              const nameMatch = fm[1].match(/^name:\s*"?([^"\n]+)"?/m);
              const descMatch = fm[1].match(/^description:\s*"?([^"\n]+)"?/m);
              if (nameMatch) name = nameMatch[1].trim();
              if (descMatch) description = descMatch[1].trim().slice(0, 200);
            }
          } catch {}
          skills.push({ id, name, description, hasScripts });
        }
      } catch {}
      return skills;
    }),

        adminGetConfig: adminProcedure.query(async () => {
      const visibility = (await getSystemConfigValue("claw_visibility", "internal")).trim() || "internal";
      const defaultTtlDays = await getSystemConfigNumber("claw_default_ttl_days", 0);
      const defaultProfile = (await getSystemConfigValue("claw_default_profile", "plus")).trim() || "plus";
      return {
        visibility: visibility === "internal" ? "internal" : "public",
        defaultTtlDays,
        defaultProfile: (defaultProfile === "internal" ? "internal" : "plus") as "plus" | "internal",
      };
    }),

    adminSetConfig: adminProcedure
      .input(z.object({
        visibility: z.enum(["public", "internal"]).optional(),
        defaultTtlDays: z.number().int().min(0).max(365).optional(),
        defaultProfile: z.enum(["plus", "internal"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (input.visibility) {
          await upsertSystemConfig(
            { key: "claw_visibility", value: input.visibility, description: "员工智能体可见性：public/internal" },
            ctx.user!.id
          );
        }
        if (typeof input.defaultTtlDays === "number") {
          await upsertSystemConfig(
            { key: "claw_default_ttl_days", value: String(input.defaultTtlDays), description: "员工智能体默认有效期（天，0 表示长期有效）" },
            ctx.user!.id
          );
        }
        if (input.defaultProfile) {
          await upsertSystemConfig(
            { key: "claw_default_profile", value: input.defaultProfile, description: "新建员工智能体默认角色：plus=员工，internal=管理员；底层 runtime 单独映射工具权限" },
            ctx.user!.id
          );
        }
        return { ok: true };
      }),

    // ── 品牌配置 ──
    adminGetBrand: adminProcedure.query(async () => {
      const { getBrandConfig } = await import("../_core/brand");
      return await getBrandConfig();
    }),

    adminSetBrand: adminProcedure
      .input(z.object({
        name: z.string().min(1).max(30).optional(),
        nameEn: z.string().min(1).max(50).optional(),
        platform: z.string().min(1).max(30).optional(),
        platformEn: z.string().min(1).max(50).optional(),
        slogan: z.string().max(100).optional(),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        logo: z.string().max(200).optional(),
        favicon: z.string().max(200).optional(),
        systemPrompt: z.string().max(500).optional(),
        agentIdentity: z.string().max(500).optional(),
        githubUrl: z.string().max(200).optional(),
        pageTitle: z.string().max(100).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { BRAND_DB_KEYS } = await import("@shared/brand");
        for (const [field, dbKey] of Object.entries(BRAND_DB_KEYS)) {
          const val = (input as any)[field];
          if (val !== undefined && val !== null) {
            await upsertSystemConfig(
              { key: dbKey, value: String(val), description: `品牌配置: ${field}` },
              ctx.user!.id
            );
          }
        }
        // 刷新缓存
        const { invalidateBrandCache } = await import("../_core/brand");
        invalidateBrandCache();
        return { ok: true };
      }),

    getSettings: protectedProcedure
      .input(z.object({ adoptId: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        const settings = await getClawProfileSettings(Number(claw.id));
        // 读取模型覆盖（存在 claw-model-overrides.json）
        let modelOverride = "";
        try {
          const { readFileSync } = await import("fs");
          const overrides = JSON.parse(readFileSync(`${APP_ROOT}/data/claw-model-overrides.json`, "utf8") || "{}");
          modelOverride = overrides[input.adoptId] || "";
        } catch {}
        const base = settings || {
          adoptionId: Number(claw.id),
          displayName: "员工智能体",
          personaPrompt: "",
          stylePreset: "steady_research",
          memoryEnabled: "yes",
          memorySummary: "",
          contextTurns: 20,
          crossSessionContext: "yes",
        };
        return { ...base, model: modelOverride };
      }),

    updateSettings: protectedProcedure
      .input(
        z.object({
          adoptId: z.string().min(1).max(64),
          displayName: z.string().max(100).optional(),
          personaPrompt: z.string().max(5000).optional(),
          stylePreset: z.enum(["steady_research", "aggressive_trading", "education_advisor", "custom"]).optional(),
          memoryEnabled: z.enum(["yes", "no"]).optional(),
          memorySummary: z.string().max(5000).optional(),
          contextTurns: z.number().int().min(5).max(100).optional(),
          crossSessionContext: z.enum(["yes", "no"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        if (Number(claw.userId) !== Number(ctx.user!.id)) {
          throw new Error("无权修改该智能体设置");
        }

        const { adoptId, ...patch } = input;
        const updated = await upsertClawProfileSettings(Number(claw.id), {
          ...patch,
          updatedBy: ctx.user!.id,
        });

        return { success: true, settings: updated };
      }),

    adopt: protectedProcedure
      .input(
        z
          .object({
            permissionProfile: z.enum(["plus", "internal"]).optional(),
            ttlDays: z.number().int().min(0).max(365).optional(),
          })
          .optional()
      )
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user!.id;

        // 可见性复用 Demo 权限模型：internal 仅 all 用户可创建
        const clawVisibility = (await getSystemConfigValue("claw_visibility", "internal")).trim() || "internal";
        const userAccessLevel = ((ctx.user as any)?.accessLevel || "public_only") as "public_only" | "all";
        if (clawVisibility === "internal" && userAccessLevel !== "all") {
          throw new Error("当前员工智能体为内部访问，仅内部权限用户可创建");
        }

        // 幂等：已有活跃/创建中实例则直接返回
        const existing = await getCurrentClawByUserId(userId);
        if (existing) {
          const normalizedExisting = {
            ...existing,
            entryUrl: String((existing as any).entryUrl || "")
              .replace("http://", "https://")
              .replace(".demo.linggantest.top", ".demo.linggan.top"),
          };
          return {
            success: true,
            reused: true,
            adoption: normalizedExisting,
          };
        }

        const defaultProfile = (await getSystemConfigValue("claw_default_profile", "plus")).trim() || "plus";
        const profile = input?.permissionProfile || (defaultProfile === "internal" ? "internal" : "plus");
        const defaultTtl = await getSystemConfigNumber("claw_default_ttl_days", 0);
        const ttlDays = input?.ttlDays ?? defaultTtl;
        // 测试主页统一直达生产 demo 域名，避免落到 linggantest 域
        const baseDomain = process.env.DEMO_ROUTE_DOMAIN || "demo.linggan.top";
        const entryScheme = (await getSystemConfigValue("claw_demo_entry_scheme", "https")).trim() || "https";

        const adoptId = `lgc-${nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)}`;
        const agentId = `trial_${adoptId}`;
        const entryUrl = `${entryScheme}://${adoptId}.${baseDomain}`;
        const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000) : null;

        const adoptionId = await createClawAdoption({
          userId,
          adoptId,
          agentId,
          status: "creating",
          permissionProfile: profile as "starter" | "plus" | "internal",
          ttlDays,
          entryUrl,
          expiresAt,
        });
        await recordAuditBestEffort({
          action: "agent.lifecycle.create_requested",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "agent",
          targetId: adoptId,
          targetName: agentId,
          agentInstanceId: adoptId,
          runtimeType: "openclaw",
          runtimeAgentId: agentId,
          metadata: { profile, ttlDays, lifecycle: ttlDays > 0 ? "temporary" : "long_lived", source: "web" },
        });

        await appendClawAdoptionEvent({
          adoptionId,
          eventType: "create_requested",
          operatorType: "user",
          operatorId: userId,
          detail: JSON.stringify({ profile, ttlDays, lifecycle: ttlDays > 0 ? "temporary" : "long_lived", source: "web" }),
        });

        try {
          // 编排创建实例（mock/local-script）
          const provision = provisionEmployeeAgentInstance({
            adoptId,
            agentId,
            userId,
            permissionProfile: profile as "starter" | "plus" | "internal",
            ttlDays,
          });

          await updateClawAdoptionStatus(adoptionId, "active");

          await appendClawAdoptionEvent({
            adoptionId,
            eventType: "create_succeeded",
            operatorType: "system",
            operatorId: null,
            detail: JSON.stringify(provision),
          });
          await recordAuditBestEffort({
            action: "agent.lifecycle.create_succeeded",
            ...auditActor(ctx.user),
            ...auditRequest(ctx.req),
            targetType: "agent",
            targetId: adoptId,
            targetName: agentId,
            agentInstanceId: adoptId,
            runtimeType: "openclaw",
            runtimeAgentId: agentId,
            metadata: {
              adoptionId,
              profile,
              ttlDays,
              entryUrl,
            },
          });

          onboardBuiltinSkillsForAdopt(adoptId, agentId).catch((error) => {
            console.warn("[SKILL-ONBOARD] failed", {
              adoptId,
              error: error instanceof Error ? error.message : String(error),
            });
          });

          const latest = await getCurrentClawByUserId(userId);
          return {
            success: true,
            reused: false,
            adoption: latest,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await updateClawAdoptionStatus(adoptionId, "failed", { lastError: msg });
          await appendClawAdoptionEvent({
            adoptionId,
            eventType: "create_failed",
            operatorType: "system",
            operatorId: null,
            detail: msg,
          });
          await recordAuditBestEffort({
            action: "agent.lifecycle.create_failed",
            result: "failed",
            severity: "medium",
            ...auditActor(ctx.user),
            ...auditRequest(ctx.req),
            targetType: "agent",
            targetId: adoptId,
            targetName: agentId,
            agentInstanceId: adoptId,
            runtimeType: "openclaw",
            runtimeAgentId: agentId,
            errorCode: "AGENT_CREATE_FAILED",
            metadata: auditErrorMetadata(error),
          });
          throw new Error(`员工智能体创建失败：${msg}`);
        }
      }),

    chat: protectedProcedure
      .input(
        z.object({
          adoptId: z.string().min(1).max(64),
          message: z.string().min(1).max(4000),
        })
      )
      .mutation(async ({ input }) => {
        const startedAt = Date.now();
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");

        // ── 每日对话额度检查 ──
        const profile = String(claw.permissionProfile || "starter");
        if (profile === "starter") {
          const dailyLimit = Number(process.env.CLAW_STARTER_DAILY_LIMIT || 50);
          const count = clawDailyUsage.increment(input.adoptId);
          if (count > dailyLimit) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `今日对话已达上限（${dailyLimit}轮），请联系管理员调整角色或配额` });
          }
        }

        // ── touch 活跃时间（best-effort）──
        touchClawActivity(input.adoptId);

        const chatMode = (process.env.CLAW_CHAT_MODE || "mock").trim();

        if (chatMode === "local-openclaw" || chatMode === "remote-openclaw") {
          const openclawHome = process.env.CLAW_OPENCLAW_HOME || process.env.OPENCLAW_HOME || "";
          const remoteOpenclawHome = OPENCLAW_HOME;
          const timeoutSec = Number(process.env.CLAW_CHAT_TIMEOUT_SECONDS || 90);
          // 安全转义：清理 shell 特殊字符，防止命令注入
          const escapedMsg = input.message
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/`/g, "\\`")
            .replace(/\$/g, "\\$")
            .replace(/\r/g, "")
            .slice(0, 4000)

          const remoteHost = process.env.CLAW_REMOTE_HOST || "";
          const remoteUser = process.env.CLAW_REMOTE_USER || "root";
          const remotePassword = process.env.CLAW_REMOTE_PASSWORD || "";
          const useRemote = chatMode === "remote-openclaw" || !!remoteHost;

          const runAgentOnce = () => {
            if (useRemote) {
              if (!remoteHost || !remotePassword) {
                throw new Error("remote-openclaw mode requires CLAW_REMOTE_HOST and CLAW_REMOTE_PASSWORD");
              }
              const remoteCmd = [
                `OPENCLAW_HOME=\"${remoteOpenclawHome}\"`,
                "openclaw agent",
                `--agent \"${claw.agentId}\"`,
                `--message \"${escapedMsg}\"`,
                "--thinking off",
                "--json",
                `--timeout ${timeoutSec}`,
              ].join(" ");

              const cmd = `sshpass -p '${remotePassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${remoteUser}@${remoteHost} \"${remoteCmd}\"`;
              return execSync(cmd, {
                cwd: process.cwd(),
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
                encoding: "utf8",
              }).trim();
            }

            const cmd = [
              openclawHome ? `OPENCLAW_HOME=\"${openclawHome}\"` : "",
              "openclaw agent",
              `--agent \"${claw.agentId}\"`,
              `--message \"${escapedMsg}\"`,
              "--json",
              `--timeout ${timeoutSec}`,
            ]
              .filter(Boolean)
              .join(" ");

            return execSync(cmd, {
              cwd: process.cwd(),
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
              encoding: "utf8",
            }).trim();
          };

          try {
            let out = "";
            try {
              out = runAgentOnce();
            } catch (firstErr: any) {
              const firstMsg = firstErr?.stderr?.toString?.() || firstErr?.message || String(firstErr);
              if (String(firstMsg).includes("Unknown agent id")) {
                // 懒创建：老记录可能是 mock 阶段生成，首次聊天时补建 agent
                if (useRemote) {
                  const addCmd = [
                    `OPENCLAW_HOME=\"${remoteOpenclawHome}\"`,
                    "openclaw agents add",
                    `\"${claw.agentId}\"`,
                    `--workspace \"${OPENCLAW_HOME}/workspace-lingganclaw/${claw.agentId}\"`,
                    "--non-interactive",
                  ].join(" ");
                  const sshCmd = `sshpass -p '${remotePassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${remoteUser}@${remoteHost} \"${addCmd}\"`;
                  execSync(sshCmd, {
                    cwd: process.cwd(),
                    env: process.env,
                    stdio: ["ignore", "pipe", "pipe"],
                    encoding: "utf8",
                  });
                } else {
                  provisionEmployeeAgentInstance({
                    adoptId: input.adoptId,
                    agentId: claw.agentId,
                    userId: Number(claw.userId),
                    permissionProfile: (claw.permissionProfile as any) || "starter",
                    ttlDays: Number(claw.ttlDays || 7),
                  });
                }
                out = runAgentOnce();
              } else {
                throw firstErr;
              }
            }

            let parsed: any = null;
            try {
              parsed = out ? JSON.parse(out) : null;
            } catch {
              parsed = { raw: out };
            }

            const reply =
              parsed?.result?.payloads?.[0]?.text ||
              parsed?.result?.payload?.text ||
              parsed?.response?.text ||
              parsed?.response ||
              parsed?.reply ||
              parsed?.text ||
              parsed?.raw ||
              "（已调用 OpenClaw，但未解析到回复文本）";

            writeClawExecAudit({
              adoptId: input.adoptId,
              agentId: String((claw as any).agentId || ""),
              userId: Number((claw as any).userId || 0),
              permissionProfile: String((claw as any).permissionProfile || "starter"),
              message: input.message,
              ok: true,
              durationMs: Date.now() - startedAt,
              meta: parsed?.meta || null,
            });

            return {
              ok: true,
              adoptId: input.adoptId,
              reply: String(reply),
              ts: Date.now(),
              mode: chatMode,
            };
          } catch (error: any) {
            const msg = error?.stderr?.toString?.() || error?.message || String(error);
            writeClawExecAudit({
              adoptId: input.adoptId,
              agentId: String((claw as any).agentId || ""),
              userId: Number((claw as any).userId || 0),
              permissionProfile: String((claw as any).permissionProfile || "starter"),
              message: input.message,
              ok: false,
              durationMs: Date.now() - startedAt,
              error: msg,
            });
            throw new Error(`员工智能体对话引擎调用失败：${msg}`);
          }
        }

        // 默认 mock
        const reply = `员工智能体已收到：${input.message}\n\n（对话引擎接入中，下一步将切到真实 OpenClaw 会话）`;
        return {
          ok: true,
          adoptId: input.adoptId,
          reply,
          ts: Date.now(),
          mode: "mock",
        };
      }),

    // ── 技能管理 ──────────────────────────────────────────────
    // ── 技能管理（三层架构）────────────────────────────────────
    // Layer1: openclaw 系统内置  /usr/lib/node_modules/openclaw/skills/
    // Layer2: 灵感公共金融技能  /root/.openclaw/skills-shared/
    // Layer3: 智能体私有技能      /root/.openclaw/workspace-lingganclaw/{agentId}/skills/
    listSkills: publicProcedure
      .input(z.object({ adoptId: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");

        // Hermes runtime (lgh-*) 走专属 skill provider，读 /root/.hermes/profiles/<name>/skills/
        if (String(input.adoptId).startsWith("lgh-")) {
          const profileName = String(claw.agentId || "").replace(/^hermes:/, "").trim();
          if (!profileName) {
            return { shared: [], system: [], private: [], privateNotInstalled: [] };
          }
          const { listHermesSkills } = await import("../_core/hermes-skills");
          const hermesSkills = listHermesSkills(profileName);
          const hermesSkillsRoot = hermesProfileSkillsDir(profileName);
          // 复用 SkillsPage 现有 UI 三栏（shared/system/private）：
          //   bundled Hermes skills → system（"系统/平台技能"）
          //   auto-generated skills → private（"我的技能"，强调"自进化"卖点）
          const system = hermesSkills
            .filter((s) => !s.meta?.createdByLLM)
            .map((s) => ({
              id: s.id,
              label: s.name,
              desc: s.description || "Hermes 自带技能",
              emoji: s.emoji || "🧩",
              source: "system" as const,
              scope: "system" as const,
              sourcePath: `${hermesSkillsRoot}/${s.id}`,
              visible: true,
              runnable: true,
              reason: "",
              active: true,
              category: s.category,
            }));
          const privateSkills = hermesSkills
            .filter((s) => s.meta?.createdByLLM)
            .map((s) => ({
              id: s.id,
              label: `🌱 ${s.name}`,
              desc: s.description || "Hermes 自动沉淀",
              emoji: "🌱",
              source: "private" as const,
              scope: "private" as const,
              sourcePath: `${hermesSkillsRoot}/${s.id}`,
              visible: true,
              runnable: true,
              reason: "",
              active: true,
              category: s.category,
            }));
          return {
            shared: [],
            system,
            private: privateSkills,
            privateNotInstalled: [],
          };
        }

        const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
        const remoteUser = process.env.CLAW_REMOTE_USER || "root";
        const remotePassword = process.env.CLAW_REMOTE_PASSWORD || "";
        const userSkillsDir = `${openClawWorkspaceDir(String(claw.agentId || ""))}/skills`;
        const sharedSkillsDir = openClawSharedSkillsDir();
        const systemSkillsDir = `/usr/lib/node_modules/openclaw/skills`;
        const useRemote = !!remoteHost && remoteHost !== "127.0.0.1";

        const runRemote = (cmd: string) => {
          if (useRemote) {
            return execSync(`sshpass -p '${remotePassword.replace(/'/g, "'\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${remoteUser}@${remoteHost} "${cmd}"`, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
          }
          return execSync(cmd, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
        };

        const SHARED_META: Record<string, { label: string; desc: string; emoji: string }> = {};

        const SYSTEM_META: Record<string, { label: string; desc: string; emoji: string }> = {
          // 办公效率
          "docx":             { label: "Word 文档", desc: "创建、读取、编辑 Word 文档", emoji: "📄" },
          "xlsx":             { label: "Excel 表格", desc: "电子表格与数据分析", emoji: "📊" },
          "pdf":              { label: "PDF 处理", desc: "读取、创建、合并 PDF", emoji: "📑" },
          "pptx-doc":         { label: "PPT 演示", desc: "创建与编辑演示文稿", emoji: "📽" },
          "internal-comms":   { label: "公文写作", desc: "通知、纪要、周报模板", emoji: "📋" },
          // 金融分析
          "stock-query":      { label: "股票行情", desc: "A股/港股/美股实时行情", emoji: "📈" },
          "finance-news":     { label: "金融资讯", desc: "市场动态与宏观政策", emoji: "📰" },
          "research-report":  { label: "研报解读", desc: "研究报告与财务数据", emoji: "🔬" },
          "quant-lite":       { label: "量化工具", desc: "技术指标与趋势判断", emoji: "📉" },
          // 工具
          "skill-creator":    { label: "技能工坊", desc: "设计与创建新技能", emoji: "🛠" },
          "weather":          { label: "天气查询", desc: "查询城市实时天气", emoji: "🌤" },
        };

        const lsLines = (cmd: string) => {
          try {
            const out = runRemote(cmd);
            return out ? out.split("\n").map(s => s.trim()).filter(Boolean) : [];
          } catch {
            return [];
          }
        };

        // discovery: system/shared/private 三层统一发现
        const systemIds = lsLines(`ls ${systemSkillsDir} 2>/dev/null || echo ""`);
        const sharedIds = lsLines(`ls ${sharedSkillsDir} 2>/dev/null || echo ""`);
        const privateIdsRaw = lsLines(`cd ${userSkillsDir} 2>/dev/null && find . -maxdepth 1 -not -type l -mindepth 1 -printf '%f\n' | sort || echo ""`);
        const activeSkills = lsLines(`ls ${userSkillsDir} 2>/dev/null || echo ""`);

        const privateIds = privateIdsRaw.filter(id => !sharedIds.includes(id) && !systemIds.includes(id));

        // only show skills defined in SYSTEM_META (deps satisfied on this host)
        const system = systemIds.filter(id => id in SYSTEM_META).map((id) => {
          const active = activeSkills.includes(id);
          return {
            id,
            label: SYSTEM_META[id]?.label || id,
            desc: SYSTEM_META[id]?.desc || "系统技能",
            emoji: SYSTEM_META[id]?.emoji || "🧩",
            source: "system" as const,
            scope: "system" as const,
            sourcePath: `${systemSkillsDir}/${id}`,
            visible: true,
            runnable: active,
            reason: active ? "" : "not_mounted",
            active,
          };
        });

        const shared = sharedIds.map((id) => {
          const active = activeSkills.includes(id);
          return {
            id,
            label: SHARED_META[id]?.label || id,
            desc: SHARED_META[id]?.desc || "公共金融技能",
            emoji: SHARED_META[id]?.emoji || "💹",
            source: "shared" as const,
            scope: "shared" as const,
            sourcePath: `${sharedSkillsDir}/${id}`,
            visible: true,
            runnable: active,
            reason: active ? "" : "not_mounted",
            active,
          };
        });

        const privateSkills = privateIds.map((id) => ({
          id,
          label: id,
          desc: "自定义技能",
          emoji: "⚡",
          source: "private" as const,
          scope: "private" as const,
          sourcePath: `${userSkillsDir}/${id}`,
          ownerAgentId: String(claw.agentId || ""),
          visible: true,
          runnable: true,
          reason: "",
          active: true,
        }));

        return {
          system,
          shared,
          private: privateSkills,
          summary: {
            discovered: system.length + shared.length + privateSkills.length,
            runnable: system.filter(s => s.runnable).length + shared.filter(s => s.runnable).length + privateSkills.filter(s => s.runnable).length,
          },
        };
      }),

    toggleSkill: protectedProcedure
      .input(z.object({
        adoptId: z.string().min(1).max(64),
        skillId: z.string().min(1).max(64),
        enable: z.boolean(),
        source: z.enum(["system", "shared"]),  // 只有 system/shared 需要 toggle；private 永远激活
      }))
      .mutation(async ({ input, ctx }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        if (String(claw.userId) !== String(ctx.user!.id)) throw new Error("无权操作");

        const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
        const remoteUser = process.env.CLAW_REMOTE_USER || "root";
        const remotePassword = process.env.CLAW_REMOTE_PASSWORD || "";
        const useRemote = !!remoteHost && remoteHost !== "127.0.0.1";

        // 与个人技能链路对齐：运行时优先 trial_{adoptId}
        const trialAgentId = `trial_${input.adoptId}`;
        const trialAgentDir = `${OPENCLAW_HOME}/agents/${trialAgentId}`;
        const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : String(claw.agentId || "");

        const userSkillLink = `${openClawWorkspaceDir(runtimeAgentId)}/skills/${input.skillId}`;
        // 源目录：system 来自 openclaw 内置，shared 来自公共库
        const srcDir = input.source === "system"
          ? `/usr/lib/node_modules/openclaw/skills/${input.skillId}`
          : `${openClawSharedSkillsDir()}/${input.skillId}`;

        const runCmd = (cmd: string) => {
          if (useRemote) {
            execSync(`sshpass -p '${remotePassword.replace(/'/g, "'\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${remoteUser}@${remoteHost} "${cmd}"`, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] });
          } else {
            execSync(cmd, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] });
          }
        };

        const userSkillsBase = `${openClawWorkspaceDir(runtimeAgentId)}/skills`;
        if (input.enable) {
          // 使用软链接指向共享源目录，改技能时智能体自动获得最新版本，无需重新 toggle
          runCmd(`mkdir -p "${userSkillsBase}" && rm -rf "${userSkillLink}" 2>/dev/null || true && ln -sfn "${srcDir}" "${userSkillLink}"`);
        } else {
          // 删除软链接（不影响源目录）
          runCmd(`rm -f "${userSkillLink}" 2>/dev/null || true`);
        }

        // 与个人技能安装链路对齐：技能变更后 bump epoch，触发聊天使用新技能快照
        bumpClawSessionEpochBestEffort(String(input.adoptId));

        await recordAuditBestEffort({
          action: input.enable ? "skill.enabled" : "skill.disabled",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: input.skillId,
          resourceType: "agent",
          resourceId: input.adoptId,
          agentInstanceId: input.adoptId,
          runtimeType: String(input.adoptId).startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId,
          metadata: { source: input.source },
        });

        return { ok: true, skillId: input.skillId, enabled: input.enable };
      }),

    // 上传/创建私有技能
    upsertPrivateSkill: protectedProcedure
      .input(z.object({
        adoptId: z.string().min(1).max(64),
        skillId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "技能ID只能包含小写字母、数字和连字符"),
        skillMd: z.string().min(10).max(50000),  // SKILL.md 内容
      }))
      .mutation(async ({ input, ctx }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        if (String(claw.userId) !== String(ctx.user!.id)) throw new Error("无权操作");

        const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
        const remoteUser = process.env.CLAW_REMOTE_USER || "root";
        const remotePassword = process.env.CLAW_REMOTE_PASSWORD || "";
        const useRemote = !!remoteHost && remoteHost !== "127.0.0.1";

        const skillDir = `${openClawWorkspaceDir(String(claw.agentId || ""))}/skills/${input.skillId}`;
        const escaped = input.skillMd.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/`/g, "\\`");

        if (useRemote) {
          const cmd = `mkdir -p "${skillDir}" && printf '%s' '${escaped}' > "${skillDir}/SKILL.md"`;
          execSync(`sshpass -p '${remotePassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${remoteUser}@${remoteHost} "${cmd}"`, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] });
        } else {
          const fs = await import("fs");
          fs.mkdirSync(skillDir, { recursive: true });
          fs.writeFileSync(`${skillDir}/SKILL.md`, input.skillMd, "utf8");
        }
        await recordAuditBestEffort({
          action: "skill.private.upserted",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: input.skillId,
          resourceType: "agent",
          resourceId: input.adoptId,
          agentInstanceId: input.adoptId,
          runtimeType: String(input.adoptId).startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId: String(claw.agentId || ""),
          metadata: {
            skillMdBytes: Buffer.byteLength(input.skillMd, "utf8"),
          },
        });
        return { ok: true, skillId: input.skillId };
      }),

    // 删除私有技能
    deletePrivateSkill: protectedProcedure
      .input(z.object({
        adoptId: z.string().min(1).max(64),
        skillId: z.string().min(1).max(64),
      }))
      .mutation(async ({ input, ctx }) => {
        const claw = await getClawByAdoptId(input.adoptId);
        if (!claw) throw new Error("智能体实例不存在");
        if (String(claw.userId) !== String(ctx.user!.id)) throw new Error("无权操作");

        const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
        const remoteUser = process.env.CLAW_REMOTE_USER || "root";
        const remotePassword = process.env.CLAW_REMOTE_PASSWORD || "";
        const useRemote = !!remoteHost && remoteHost !== "127.0.0.1";

        const skillDir = `${openClawWorkspaceDir(String(claw.agentId || ""))}/skills/${input.skillId}`;
        if (useRemote) {
          execSync(`sshpass -p '${remotePassword.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${remoteUser}@${remoteHost} "rm -rf '${skillDir}' 2>/dev/null || true"`, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] });
        } else {
          const fs = await import("fs");
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
        await recordAuditBestEffort({
          action: "skill.private.deleted",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "skill",
          targetId: input.skillId,
          resourceType: "agent",
          resourceId: input.adoptId,
          agentInstanceId: input.adoptId,
          runtimeType: String(input.adoptId).startsWith("lgh-") ? "hermes" : "openclaw",
          runtimeAgentId: String(claw.agentId || ""),
        });
        return { ok: true };
      }),

    // getMemory / updateMemory tRPC 端点已删除 (2026-04-20 review)
    // 原 OpenClaw 硬编码 sshpass 路径; Home.tsx 死代码清理后无调用
    // 前端改用 REST /api/claw/core-files/* + /api/claw/memory/* (已分叉 lgh-/lgc-)

    // ── 会话历史（localStorage 为主，DB 备用）─────────────────
    // 前端用 localStorage，此接口供未来 DB 持久化预留
    getMessages: protectedProcedure
      .input(z.object({ adoptId: z.string().min(1).max(64), limit: z.number().min(1).max(200).default(50) }))
      .query(async ({ input, ctx }) => {
        await assertClawOwnerOrThrow(ctx, input.adoptId);
        // 暂时返回空，前端用 localStorage
        return { messages: [] as Array<{ role: string; text: string; ts: number }> };
      }),

    // ── Day 4: TIL 审计面板 API (管理员) ─────────────────────────────
    adminTenantAuditList: adminProcedure
      .input(z.object({
        userId: z.number().int().positive().optional(),
        agentId: z.string().max(64).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      }).optional())
      .query(async ({ input }) => {
        const rows = await listBusinessAgentAudit({
          userId: input?.userId,
          agentId: input?.agentId,
          fromIso: input?.from,
          toIso: input?.to,
          limit: input?.limit,
        });
        return { rows, count: rows.length };
      }),

    adminTenantAuditReverse: adminProcedure
      .input(z.object({ tenantToken: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        return await reverseTenantToken(input.tenantToken);
      }),

    adminTenantAuditStats: adminProcedure
      .query(async () => {
        return await getTenantAuditStats();
      }),

});
