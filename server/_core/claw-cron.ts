import express from "express";
import { requireClawOwner, resolveRuntimeAgentId } from "./helpers";
import { hermesCron, type CronProviderHandle } from "./hermes-cron";
import { OpenClawCronProvider } from "./cron/openclaw-cron-provider";
import { startCronRunWatcher } from "./cron/cron-run-watcher";
import { deleteCronDeliveryConfig, saveCronDeliveryConfig } from "./cron-delivery";
import { normalizeChannelId } from "./cron/channel-provider-registry";
import type { CronJobInput, CronProviderHandle as SharedCronProviderHandle, CronSchedule } from "@shared/types/cron";

const openClawCronProvider = new OpenClawCronProvider();

function isHermesAdopt(adoptId: string): boolean {
  return String(adoptId || "").startsWith("lgh-");
}

function toHermesHandle(claw: any): CronProviderHandle {
  return {
    adoptId: claw.adoptId,
    agentId: String(claw.agentId || ""),
    userId: Number(claw.userId || 0),
    hermesPort: claw.hermesPort,
  };
}

function toOpenClawHandle(claw: any): SharedCronProviderHandle {
  const adoptId = String(claw.adoptId || "");
  return {
    adoptId,
    agentId: resolveRuntimeAgentId(adoptId, (claw as any).agentId),
    userId: Number(claw.userId || 0),
    runtime: "openclaw",
  };
}

async function resolveClaw(req: express.Request, res: express.Response, adoptId: string) {
  const internalKey = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
  if (req.headers["x-internal-key"] === internalKey) {
    const { getClawByAdoptId } = await import("../db");
    const claw = await getClawByAdoptId(adoptId);
    if (!claw) {
      res.status(404).json({ error: "NOT_FOUND" });
      return undefined;
    }
    return claw;
  }
  return requireClawOwner(req, res, adoptId);
}

function cronScheduleFromRequest(raw: any): CronSchedule {
  const kind = String(raw?.kind || "cron");
  if (kind === "interval" || kind === "every") {
    const intervalMinutes = Number(raw?.intervalMinutes || (raw?.everyMs ? Math.round(Number(raw.everyMs) / 60000) : 0) || 30);
    return { kind: "interval", intervalMinutes, display: `每 ${intervalMinutes} 分钟` };
  }
  if (kind === "once" || kind === "at") {
    const runAt = String(raw?.runAt || raw?.at || "");
    return { kind: "once", runAt, display: runAt };
  }
  const cronExpr = String(raw?.cronExpr || raw?.expr || "0 9 * * *");
  return { kind: "cron", cronExpr, display: raw?.display ? String(raw.display) : cronExpr };
}

function cronDeliveryFromRequest(raw: any): CronJobInput["delivery"] {
  const targets = Array.isArray(raw?.targets) ? raw.targets : [];
  const first = targets[0];
  if (first?.channelId) {
    const channelId = normalizeChannelId(String(first.channelId));
    if (channelId) {
      return {
        targets: [{
          channelId,
          channelLabel: first.channelLabel || (channelId === "wechat" ? "微信" : channelId === "feishu" ? "飞书" : "企业微信"),
          targetId: first.targetId,
          targetLabel: first.targetLabel,
          format: first.format,
        }],
      };
    }
  }

  const channelId = normalizeChannelId(String(raw?.channel || raw?.to || raw?.mode || (raw?.weixin ? "wechat" : ""))) || "wechat";
  return {
    targets: [{
      channelId,
      channelLabel: channelId === "wechat" ? "微信" : channelId === "feishu" ? "飞书" : "企业微信",
      targetId: raw?.target || raw?.to,
      targetLabel: raw?.targetLabel,
    }],
  };
}

function cronJobInputFromRequest(job: any): CronJobInput {
  return {
    name: String(job?.name || "定时任务").trim() || "定时任务",
    description: job?.description ? String(job.description) : undefined,
    enabled: job?.enabled !== false,
    schedule: cronScheduleFromRequest(job?.schedule || {}),
    prompt: String(job?.prompt || job?.payload?.message || ""),
    delivery: cronDeliveryFromRequest(job?.delivery || {}),
    meta: {
      sessionTarget: job?.sessionTarget || "isolated",
      skills: job?.skills,
      model: job?.payload?.model || job?.model,
    },
  };
}

function validateCronInputSafety(input: CronJobInput): string | null {
  const minIntervalMinutes = 30;
  if (input.schedule.kind === "interval" && input.schedule.intervalMinutes < minIntervalMinutes) {
    return `执行间隔不能低于 ${minIntervalMinutes} 分钟`;
  }
  if (input.schedule.kind === "cron") {
    const minutePart = input.schedule.cronExpr.trim().split(/\s+/)[0] || "";
    const stepMatch = minutePart.match(/^\*\/(\d+)$/);
    if (minutePart === "*" || (stepMatch && Number(stepMatch[1]) < minIntervalMinutes)) {
      return "cron 表达式执行频率不能高于每 30 分钟";
    }
  }
  if (input.schedule.kind === "once" && !input.schedule.runAt) return "单次任务时间不能为空";
  return null;
}

function providerErrorStatus(kind?: string) {
  if (kind === "validation_failed") return 400;
  if (kind === "not_found") return 404;
  return 500;
}

export function registerCronRoutes(app: express.Express) {
  app.get("/api/claw/cron/status", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      if (isHermesAdopt(adoptId)) {
        const jobs = await hermesCron.listJobs(toHermesHandle(claw));
        const enabled = jobs.filter((j) => j.enabled);
        const nextRunIso = enabled.map((j) => j.state.nextRunAt).filter(Boolean).sort()[0];
        return res.json({
          enabled: true,
          runtime: "hermes",
          jobs: jobs.length,
          enabledJobs: enabled.length,
          nextRunAt: nextRunIso || undefined,
          nextWakeAtMs: nextRunIso ? new Date(nextRunIso).getTime() : undefined,
        });
      }

      const listed = await openClawCronProvider.listJobs(toOpenClawHandle(claw));
      if (!listed.ok) return res.status(500).json({ error: listed.error.detail });
      const enabled = listed.value.filter((j) => j.enabled);
      const nextRunIso = enabled.map((j) => j.state.nextRunAt).filter(Boolean).sort()[0];
      return res.json({
        enabled: true,
        runtime: "openclaw",
        jobs: listed.value.length,
        enabledJobs: enabled.length,
        nextRunAt: nextRunIso || undefined,
        nextWakeAtMs: nextRunIso ? new Date(nextRunIso).getTime() : undefined,
      });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron status failed") });
    }
  });

  app.get("/api/claw/cron/capabilities", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) return res.json({ runtime: "hermes", capabilities: hermesCron.capabilities() });
      return res.json({ runtime: "openclaw", capabilities: openClawCronProvider.capabilities() });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "capabilities failed") });
    }
  });

  app.get("/api/claw/cron/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await resolveClaw(req, res, adoptId);
      if (!claw) return;

      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
      const offset = Math.max(0, Number(req.query.offset || 0));
      const query = String(req.query.query || "").trim().toLowerCase();
      const enabled = String(req.query.enabled || "all");
      const scheduleKind = String(req.query.scheduleKind || "all");

      if (isHermesAdopt(adoptId)) {
        let jobs = await hermesCron.listJobs(toHermesHandle(claw));
        if (query) jobs = jobs.filter((j) => j.name.toLowerCase().includes(query) || (j.description || "").toLowerCase().includes(query));
        const total = jobs.length;
        return res.json({ runtime: "hermes", capabilities: hermesCron.capabilities(), jobs: jobs.slice(offset, offset + limit), total, limit, offset });
      }

      const listed = await openClawCronProvider.listJobs(toOpenClawHandle(claw));
      if (!listed.ok) return res.status(providerErrorStatus(listed.error.kind)).json({ error: listed.error.detail });
      let jobs = listed.value;
      if (query) jobs = jobs.filter((j) => String(j.name || "").toLowerCase().includes(query) || String(j.description || "").toLowerCase().includes(query));
      if (enabled === "enabled") jobs = jobs.filter((j) => j.enabled !== false);
      if (enabled === "disabled") jobs = jobs.filter((j) => j.enabled === false);
      if (["interval", "once", "cron"].includes(scheduleKind)) jobs = jobs.filter((j) => String(j.schedule?.kind || "") === scheduleKind);
      const total = jobs.length;
      return res.json({ runtime: "openclaw", capabilities: openClawCronProvider.capabilities(), jobs: jobs.slice(offset, offset + limit), total, limit, offset });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron list failed") });
    }
  });

  app.get("/api/claw/cron/runs", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await resolveClaw(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) return res.status(501).json({ error: "Hermes cron runs are not supported yet" });

      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
      const offset = Math.max(0, Number(req.query.offset || 0));
      const jobId = String(req.query.jobId || "").trim();
      const scope = String(req.query.scope || "all").trim();
      const handle = toOpenClawHandle(claw);

      const listed = await openClawCronProvider.listJobs(handle);
      if (!listed.ok) return res.status(providerErrorStatus(listed.error.kind)).json({ error: listed.error.detail });
      const targetJobs = jobId ? listed.value.filter((j) => String(j.id) === jobId) : listed.value;
      let runs: any[] = [];
      for (const job of targetJobs.slice(0, 50)) {
        const runResult = await openClawCronProvider.listRuns(handle, job.id, 100);
        if (!runResult.ok) {
          console.warn("[CRON-PROVIDER] listRuns failed for job", { adoptId, jobId: job.id, error: runResult.error });
          continue;
        }
        runs.push(...runResult.value.map((run) => ({ ...run, jobName: job.name })));
      }
      if (["ok", "error", "skipped", "timeout", "canceled"].includes(scope)) runs = runs.filter((r: any) => String(r?.status || "") === scope);
      runs.sort((a: any, b: any) => Date.parse(String(b?.startedAt || "")) - Date.parse(String(a?.startedAt || "")));
      const total = runs.length;
      return res.json({ runs: runs.slice(offset, offset + limit), total, limit, offset });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron runs failed") });
    }
  });

  app.post("/api/claw/cron/preview-runs", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) return res.status(501).json({ error: "Hermes cron preview is not supported yet" });
      const result = await openClawCronProvider.previewRuns({
        adoptId,
        schedule: req.body?.schedule,
        timezone: req.body?.timezone,
        count: req.body?.count || 5,
        wakeOffsetSeconds: req.body?.wakeOffsetSeconds,
      });
      if (!result.ok) return res.status(400).json({ error: result.error.detail });
      return res.json(result.value);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "preview runs failed") });
    }
  });

  app.post("/api/claw/cron/add", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const job = req.body?.job || {};
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await resolveClaw(req, res, adoptId);
      if (!claw) return;

      if (isHermesAdopt(adoptId)) {
        const sched = job?.schedule || {};
        const k = String(sched.kind || "interval");
        const linggKind: "interval" | "cron" | "once" = k === "every" ? "interval" : k === "at" ? "once" : k === "interval" ? "interval" : k === "cron" ? "cron" : k === "once" ? "once" : "interval";
        const created = await hermesCron.addJob(toHermesHandle(claw), {
          prompt: job?.payload?.message || job?.prompt || "",
          schedule: {
            kind: linggKind,
            intervalMinutes: k === "every" && sched.everyMs ? Math.round(Number(sched.everyMs) / 60000) : sched.intervalMinutes,
            cronExpr: sched.expr || sched.cronExpr,
            runAt: sched.at || sched.runAt,
          },
          name: job?.name,
          description: job?.description,
          delivery: job?.delivery?.mode ? { mode: String(job.delivery.mode) } : undefined,
          meta: { skills: job?.skills, model: job?.payload?.model || job?.model },
        });
        return res.json({ runtime: "hermes", job: created });
      }

      const handle = toOpenClawHandle(claw);
      const input = cronJobInputFromRequest(job);
      const safetyError = validateCronInputSafety(input);
      if (safetyError) return res.status(400).json({ error: safetyError });

      const existing = await openClawCronProvider.listJobs(handle);
      if (existing.ok && existing.value.length >= 5) {
        return res.status(400).json({ error: `每个智能体最多 5 个定时任务，当前已有 ${existing.value.length} 个` });
      }

      const result = await openClawCronProvider.addJob(handle, input);
      if (!result.ok) return res.status(providerErrorStatus(result.error.kind)).json({ error: result.error.detail });

      const target = input.delivery.targets[0];
      try {
        if (target?.channelId) {
          await saveCronDeliveryConfig(adoptId, result.value.name || input.name, target.channelId, result.value.id);
        }
      } catch (saveError: any) {
        console.error("[CRON] failed to save Lingxia delivery config after cron.add; rolling back OpenClaw job", {
          adoptId,
          jobId: result.value.id,
          error: saveError?.message || String(saveError),
        });
        const rollback = await openClawCronProvider.removeJob(handle, result.value.id);
        if (!rollback.ok) {
          console.error("[CRON-ORPHAN] rollback removeJob failed after delivery config save error", {
            adoptId,
            jobId: result.value.id,
            error: rollback.error,
          });
        }
        return res.status(500).json({ error: "定时任务创建失败：投递配置保存失败，已回滚任务" });
      }
      return res.json({ runtime: "openclaw", job: result.value });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron add failed") });
    }
  });

  app.post("/api/claw/cron/update", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      const patch = req.body?.patch || {};
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      if (isHermesAdopt(adoptId)) {
        const linggPatch: any = {};
        if (patch.name !== undefined) linggPatch.name = patch.name;
        if (patch.enabled !== undefined) linggPatch.enabled = patch.enabled;
        if (patch?.payload?.message !== undefined) linggPatch.prompt = patch.payload.message;
        if (patch.prompt !== undefined) linggPatch.prompt = patch.prompt;
        if (patch.schedule !== undefined) {
          const sk = String(patch.schedule?.kind || "");
          const linggKind = sk === "every" ? "interval" : sk === "at" ? "once" : (sk === "interval" || sk === "cron" || sk === "once") ? sk : undefined;
          if (linggKind) {
            linggPatch.schedule = {
              kind: linggKind as any,
              intervalMinutes: sk === "every" && patch.schedule.everyMs ? Math.round(Number(patch.schedule.everyMs) / 60000) : patch.schedule.intervalMinutes,
              cronExpr: patch.schedule.expr || patch.schedule.cronExpr,
              runAt: patch.schedule.at || patch.schedule.runAt,
            };
          }
        }
        if (patch.delivery?.mode !== undefined) linggPatch.delivery = { mode: String(patch.delivery.mode), target: patch.delivery?.to };
        if (patch.skills !== undefined) linggPatch.meta = { ...(linggPatch.meta || {}), skills: patch.skills };
        if (patch?.payload?.model !== undefined) linggPatch.meta = { ...(linggPatch.meta || {}), model: patch.payload.model };
        if (patch.model !== undefined) linggPatch.meta = { ...(linggPatch.meta || {}), model: patch.model };
        const out = await hermesCron.updateJob(toHermesHandle(claw), id, linggPatch);
        return res.json({ runtime: "hermes", job: out });
      }

      const result = await openClawCronProvider.updateJob(toOpenClawHandle(claw), id, patch);
      if (!result.ok) return res.status(providerErrorStatus(result.error.kind)).json({ error: result.error.detail });
      return res.json({ runtime: "openclaw", job: result.value });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron update failed") });
    }
  });

  app.post("/api/claw/cron/run", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      if (isHermesAdopt(adoptId)) {
        const out = await hermesCron.triggerJob(toHermesHandle(claw), id);
        return res.json({ runtime: "hermes", job: out });
      }

      const handle = toOpenClawHandle(claw);
      const listed = await openClawCronProvider.listJobs(handle);
      const job = listed.ok ? listed.value.find((item) => item.id === id) : undefined;
      const startedAtMs = Date.now();
      const result = await openClawCronProvider.runJobNow(handle, id);
      if (!result.ok) return res.status(providerErrorStatus(result.error.kind)).json({ error: result.error.detail });

      startCronRunWatcher({
        adoptId,
        jobId: id,
        jobName: job?.name || id,
        runId: result.value.runId,
        startedAtMs,
      }).catch((error: any) => {
        console.warn("[CRON-WATCHER] failed after cron.run response", {
          adoptId,
          jobId: id,
          runId: result.value.runId,
          error: error?.message || String(error),
        });
      });
      return res.json({ runtime: "openclaw", ok: true, ...result.value, watcher: "started" });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron run failed") });
    }
  });

  app.post("/api/claw/cron/remove", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const claw = await resolveClaw(req, res, adoptId);
      if (!claw) return;

      if (isHermesAdopt(adoptId)) {
        await hermesCron.removeJob(toHermesHandle(claw), id);
        await deleteCronDeliveryConfig(adoptId, id);
        return res.json({ runtime: "hermes", ok: true });
      }

      const result = await openClawCronProvider.removeJob(toOpenClawHandle(claw), id);
      if (!result.ok) return res.status(providerErrorStatus(result.error.kind)).json({ error: result.error.detail });
      await deleteCronDeliveryConfig(adoptId, id);
      return res.json({ runtime: "openclaw", ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron remove failed") });
    }
  });
}
