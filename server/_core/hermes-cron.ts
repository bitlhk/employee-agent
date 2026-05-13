/**
 * Hermes cron provider — implements LinggClawCronJob CRUD by calling
 * the per-profile hermes-http /cron/* endpoints.
 *
 * Per CODING_GUIDELINES.md rules 1-6:
 *   - All Hermes cron-specific logic lives in this file (rule 1)
 *   - File named hermes-cron.ts (rule 2)
 *   - LinggClawCronJob type defined here, ARPI base.ts will adopt it (rule 3)
 *   - claw-cron.ts router does `isHermes ? hermesCron : openclawInline` ONCE at entry (rule 4)
 *   - Hermes-specific fields (skills/script/repeat) flow through .meta (rule 5)
 *   - Only IO-layer abstraction; no normalization of Hermes' internal cognitive model (rule 6)
 */
import * as httpMod from "node:http";

const DEFAULT_HERMES_PORT = 8643;

// ────────────────────────────────────────────────────────────────────
// Types — destined for runtime-providers/base.ts when ARPI is extracted
// ────────────────────────────────────────────────────────────────────

export type LinggClawCronJob = {
  id: string;
  runtime: "openclaw" | "hermes" | "jiuwenclaw" | "hi-agent" | string;
  adoptId: string;
  name: string;
  enabled: boolean;
  prompt?: string;            // optional — jiuwenclaw cron has no prompt concept
  description?: string;
  schedule: {
    kind: "interval" | "cron" | "once";
    intervalMinutes?: number;
    cronExpr?: string;
    runAt?: string;            // ISO
    display: string;
  };
  state: {
    status: "scheduled" | "running" | "completed" | "paused" | "failed";
    nextRunAt?: string;        // ISO
    lastRunAt?: string;        // ISO
    lastStatus?: "ok" | "error" | "skipped";
    lastDurationMs?: number;
  };
  delivery?: { mode: string; target?: string };
  meta?: Record<string, any>;  // runtime-specific (skills/script/repeat/sessionTarget/...)
};

export type CronProviderCapabilities = {
  scheduleKinds: Array<"interval" | "cron" | "once">;
  promptRequired: boolean;
  supportsTimezone: boolean;
  supportsWakeOffset: boolean;
  supportsSkills: boolean;
  supportsScript: boolean;
  supportsSessionTarget: boolean;
  supportsPreview: boolean;
};

export type CronJobInput = {
  prompt?: string;
  schedule: { kind: "interval" | "cron" | "once"; intervalMinutes?: number; cronExpr?: string; runAt?: string };
  name?: string;
  description?: string;
  enabled?: boolean;
  delivery?: { mode: string; target?: string };
  meta?: Record<string, any>;
};

export type CronProviderHandle = { adoptId: string; agentId: string; userId: number; hermesPort?: number | null };

// ────────────────────────────────────────────────────────────────────
// HTTP helper — internal, talks to hermes-http /cron/*
// ────────────────────────────────────────────────────────────────────

function buildHermesScheduleString(input: CronJobInput['schedule']): string {
  if (input.kind === "cron" && input.cronExpr) return input.cronExpr;
  if (input.kind === "interval" && typeof input.intervalMinutes === "number") return `every ${input.intervalMinutes}m`;
  if (input.kind === "once" && input.runAt) return input.runAt;            // ISO accepted by parse_schedule
  if (input.kind === "once" && input.intervalMinutes) return `${input.intervalMinutes}m`;
  throw new Error(`invalid schedule: ${JSON.stringify(input)}`);
}

async function callHermes(
  claw: CronProviderHandle,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: any,
): Promise<any> {
  const port = Number(claw.hermesPort || DEFAULT_HERMES_PORT);
  const key = process.env.HERMES_HTTP_KEY || "";
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = httpMod.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "X-Internal-Key": key,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const status = res.statusCode || 0;
        try {
          const json = data ? JSON.parse(data) : {};
          if (status >= 400) reject(new Error(`hermes ${method} ${path} ${status}: ${json?.detail || data}`));
          else resolve(json);
        } catch (e: any) {
          reject(new Error(`hermes ${method} ${path} parse error: ${e?.message || e}; raw=${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────
// Schema translation: Hermes <-> LinggClaw
// ────────────────────────────────────────────────────────────────────

function hermesJobToLingg(hjob: any, adoptId: string): LinggClawCronJob {
  const hSched = hjob?.schedule || {};
  const hKind = String(hSched.kind || "");
  const schedule: LinggClawCronJob["schedule"] = {
    kind: hKind === "interval" ? "interval" : hKind === "cron" ? "cron" : "once",
    display: String(hjob?.schedule_display || hSched.display || ""),
  };
  if (hKind === "interval" && typeof hSched.minutes === "number") schedule.intervalMinutes = hSched.minutes;
  if (hKind === "cron" && hSched.expr) schedule.cronExpr = String(hSched.expr);
  if (hKind === "once" && hSched.run_at) schedule.runAt = String(hSched.run_at);

  const stateStr = String(hjob?.state || "scheduled");
  const lastStatus = hjob?.last_status ? String(hjob.last_status) as "ok" | "error" | "skipped" : undefined;

  return {
    id: String(hjob?.id || ""),
    runtime: "hermes",
    adoptId,
    name: String(hjob?.name || hjob?.id || ""),
    enabled: Boolean(hjob?.enabled),
    prompt: hjob?.prompt ? String(hjob.prompt) : undefined,
    schedule,
    state: {
      status: stateStr === "paused" ? "paused" : stateStr === "running" ? "running" : stateStr === "completed" ? "completed" : stateStr === "failed" ? "failed" : "scheduled",
      nextRunAt: hjob?.next_run_at || undefined,
      lastRunAt: hjob?.last_run_at || undefined,
      lastStatus,
      // Hermes 没暴露 lastDurationMs，前端以缺省 undefined 处理
    },
    delivery: hjob?.deliver ? { mode: String(hjob.deliver) } : undefined,
    meta: {
      skills: Array.isArray(hjob?.skills) && hjob.skills.length > 0 ? hjob.skills : undefined,
      skill: hjob?.skill || undefined,
      model: hjob?.model || undefined,
      provider: hjob?.provider || undefined,
      script: hjob?.script || undefined,
      repeat: hjob?.repeat || undefined,
      paused_at: hjob?.paused_at || undefined,
      paused_reason: hjob?.paused_reason || undefined,
      origin: hjob?.origin || undefined,
    },
  };
}

function linggInputToHermesAdd(input: CronJobInput): Record<string, any> {
  return {
    prompt: input.prompt || "",
    schedule: buildHermesScheduleString(input.schedule),
    name: input.name,
    deliver: input.delivery?.mode,
    skill: input.meta?.skill,
    skills: input.meta?.skills,
    model: input.meta?.model,
    provider: input.meta?.provider,
  };
}

function linggPatchToHermesUpdate(patch: Partial<CronJobInput> & { enabled?: boolean }): Record<string, any> {
  const body: Record<string, any> = {};
  if (patch.prompt !== undefined) body.prompt = patch.prompt;
  if (patch.schedule !== undefined) body.schedule = buildHermesScheduleString(patch.schedule);
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.delivery?.mode !== undefined) body.deliver = patch.delivery.mode;
  if (patch.meta?.skills !== undefined) body.skills = patch.meta.skills;
  if (patch.meta?.model !== undefined) body.model = patch.meta.model;
  return body;
}

// ────────────────────────────────────────────────────────────────────
// Hermes provider (capability self-report + IO-layer ops)
// ────────────────────────────────────────────────────────────────────

const HERMES_CAPABILITIES: CronProviderCapabilities = {
  scheduleKinds: ["interval", "cron", "once"],
  promptRequired: true,
  supportsTimezone: false,
  supportsWakeOffset: false,
  supportsSkills: true,
  supportsScript: true,
  supportsSessionTarget: false,
  supportsPreview: false,
};

export const hermesCron = {
  capabilities(): CronProviderCapabilities {
    return HERMES_CAPABILITIES;
  },

  async listJobs(claw: CronProviderHandle): Promise<LinggClawCronJob[]> {
    const r = await callHermes(claw, "GET", "/cron/list");
    const jobs = Array.isArray(r?.jobs) ? r.jobs : [];
    return jobs.map((j: any) => hermesJobToLingg(j, claw.adoptId));
  },

  async addJob(claw: CronProviderHandle, input: CronJobInput): Promise<LinggClawCronJob> {
    const body = linggInputToHermesAdd(input);
    const r = await callHermes(claw, "POST", "/cron/add", body);
    return hermesJobToLingg(r?.job, claw.adoptId);
  },

  async updateJob(claw: CronProviderHandle, jobId: string, patch: Partial<CronJobInput> & { enabled?: boolean }): Promise<LinggClawCronJob> {
    const body = linggPatchToHermesUpdate(patch);
    const r = await callHermes(claw, "PATCH", `/cron/update/${encodeURIComponent(jobId)}`, body);
    return hermesJobToLingg(r?.job, claw.adoptId);
  },

  async removeJob(claw: CronProviderHandle, jobId: string): Promise<void> {
    await callHermes(claw, "DELETE", `/cron/remove/${encodeURIComponent(jobId)}`);
  },

  async pauseJob(claw: CronProviderHandle, jobId: string): Promise<LinggClawCronJob> {
    const r = await callHermes(claw, "POST", `/cron/pause/${encodeURIComponent(jobId)}`);
    return hermesJobToLingg(r?.job, claw.adoptId);
  },

  async resumeJob(claw: CronProviderHandle, jobId: string): Promise<LinggClawCronJob> {
    const r = await callHermes(claw, "POST", `/cron/resume/${encodeURIComponent(jobId)}`);
    return hermesJobToLingg(r?.job, claw.adoptId);
  },

  async triggerJob(claw: CronProviderHandle, jobId: string): Promise<LinggClawCronJob> {
    const r = await callHermes(claw, "POST", `/cron/trigger/${encodeURIComponent(jobId)}`);
    return hermesJobToLingg(r?.job, claw.adoptId);
  },
};
