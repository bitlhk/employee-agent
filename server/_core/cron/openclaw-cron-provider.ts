import { Cron } from "croner";
import type {
  ChannelId,
  CronDeliveryConfig,
  CronDeliveryTarget,
  CronJob,
  CronJobInput,
  CronProvider,
  CronProviderCapabilities,
  CronProviderHandle,
  CronResult,
  CronRunRecord,
  CronSchedule,
  PreviewRunsRequest,
  PreviewRunsResponse,
} from "@shared/types/cron";
import { createOpenClawRuntimeAdapter } from "../runtime";
import { getCronDeliveryChannel } from "../cron-delivery";
import { getWeixinStatus } from "../claw-weixin";
import { getUserBoundChannels } from "./channel-binding-query";
import { normalizeChannelId } from "./channel-provider-registry";

type RuntimeRpc = {
  callRpc<T = any>(method: string, params?: Record<string, any>): T;
};

export type OpenClawCronProviderOptions = {
  runtime?: RuntimeRpc;
  getBoundChannels?: (handle: CronProviderHandle) => Promise<ChannelId[]>;
  getWeixinStatus?: (adoptId: string) => {
    bound: boolean;
    needsReactivation?: boolean;
    accountId?: string;
    userId?: string;
    targetLabel?: string;
  };
  now?: () => Date;
};

const OPENCLAW_CRON_CAPABILITIES: CronProviderCapabilities = {
  scheduleKinds: ["once", "interval", "cron"],
  promptRequired: true,
  supportsTimezone: true,
  // Verified current OpenClaw cron payload does not expose wake_offset_seconds.
  // Keep this false until runtime contract proves native support.
  supportsWakeOffset: false,
  // Preview is Lingxia-computed via croner, not OpenClaw-native.
  supportsPreview: true,
  supportsRunNow: true,
  supportedChannels: ["wechat", "feishu"],
};

function ok<T>(value: T): CronResult<T> {
  return { ok: true, value };
}

function validationFailed<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "validation_failed", detail } };
}

function runtimeUnavailable<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "runtime_unavailable", detail } };
}

function notFound<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "not_found", detail } };
}

export function openClawScheduleFromCronSchedule(schedule: CronSchedule): Record<string, any> {
  if (schedule.kind === "once") {
    return { kind: "at", at: schedule.runAt };
  }
  if (schedule.kind === "interval") {
    return { kind: "every", everyMs: schedule.intervalMinutes * 60_000 };
  }
  return { kind: "cron", expr: schedule.cronExpr };
}

export function cronScheduleFromOpenClawSchedule(raw: any): CronSchedule {
  const kind = String(raw?.kind || "");
  if (kind === "every") {
    const everyMs = Number(raw?.everyMs || 0);
    const minutes = Math.max(1, Math.round(everyMs / 60_000));
    return {
      kind: "interval",
      intervalMinutes: minutes,
      display: `每 ${minutes} 分钟`,
    };
  }
  if (kind === "at") {
    const runAt = String(raw?.at || "");
    return {
      kind: "once",
      runAt,
      display: runAt,
    };
  }
  const expr = String(raw?.expr || "");
  return {
    kind: "cron",
    cronExpr: expr,
    display: expr,
  };
}

function channelLabel(channelId: ChannelId) {
  if (channelId === "wechat") return "微信";
  if (channelId === "feishu") return "飞书";
  return "企业微信";
}

function deliveryConfigFromRaw(adoptId: string, jobId: string, rawDelivery?: any): {
  config: CronDeliveryConfig;
  deliveryMissing: boolean;
  deliveryManagedBy?: "openclaw-native" | "lingxia-sidecar";
} {
  const configured = getCronDeliveryChannel(adoptId, jobId);
  const normalized = normalizeChannelId(configured || "");
  const channelId = normalized;
  if (channelId) {
    return {
      config: {
        targets: [{
          channelId,
          channelLabel: channelLabel(channelId),
        }],
      },
      deliveryMissing: false,
      deliveryManagedBy: "lingxia-sidecar",
    };
  }

  if (rawDelivery?.mode === "announce" && rawDelivery?.channel === "openclaw-weixin") {
    return {
      config: {
        targets: [{
          channelId: "wechat",
          channelLabel: "微信",
          targetId: typeof rawDelivery?.to === "string" ? rawDelivery.to : undefined,
          targetLabel: "微信",
        }],
      },
      deliveryMissing: false,
      deliveryManagedBy: "openclaw-native",
    };
  }

  return { config: { targets: [] }, deliveryMissing: true };
}

export function openClawJobToCronJob(raw: any, handle: CronProviderHandle): CronJob {
  const id = String(raw?.id || "");
  const name = String(raw?.name || id || "未命名定时任务");
  const createdAtMs = Number(raw?.createdAtMs || raw?.created_at_ms || 0);
  const updatedAtMs = Number(raw?.updatedAtMs || raw?.updated_at_ms || createdAtMs || Date.now());
  const state = raw?.state || {};
  const lastStatus = String(state.lastStatus || state.lastRunStatus || "");
  const delivery = deliveryConfigFromRaw(handle.adoptId, id, raw?.delivery);
  const schedule = cronScheduleFromOpenClawSchedule(raw?.schedule || {});
  const nextRunAtMs = Number(state.nextRunAtMs || 0);
  const lastRunAtMs = Number(state.lastRunAtMs || 0);

  return {
    id,
    runtime: "openclaw",
    adoptId: handle.adoptId,
    userId: handle.userId,
    name,
    enabled: raw?.enabled !== false,
    prompt: raw?.payload?.message ? String(raw.payload.message) : undefined,
    description: raw?.description ? String(raw.description) : undefined,
    schedule,
    state: {
      status: raw?.enabled === false ? "paused" : lastStatus === "error" ? "failed" : "scheduled",
      nextRunAt: nextRunAtMs ? new Date(nextRunAtMs).toISOString() : undefined,
      lastRunAt: lastRunAtMs ? new Date(lastRunAtMs).toISOString() : undefined,
      lastStatus: ["ok", "error", "skipped", "timeout", "canceled"].includes(lastStatus) ? lastStatus as any : undefined,
      lastDurationMs: typeof state.lastDurationMs === "number" ? state.lastDurationMs : undefined,
      totalRuns: typeof state.totalRuns === "number" ? state.totalRuns : undefined,
      successRuns: typeof state.successRuns === "number" ? state.successRuns : undefined,
    },
    delivery: delivery.config,
    wakeOffsetSeconds: undefined,
    meta: {
      agentId: raw?.agentId,
      sessionTarget: raw?.sessionTarget,
      wakeMode: raw?.wakeMode,
      consecutiveErrors: state.consecutiveErrors,
      lastError: state.lastError,
      deliveryMissing: delivery.deliveryMissing,
      deliveryManagedBy: delivery.deliveryManagedBy,
      createdAtMs: raw?.createdAtMs,
      updatedAtMs: raw?.updatedAtMs,
    },
    createdBy: handle.userId,
    createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : new Date(0).toISOString(),
    updatedBy: handle.userId,
    updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : new Date().toISOString(),
  };
}

function rawRunsFromResponse(response: any): any[] {
  if (Array.isArray(response?.runs)) return response.runs;
  if (Array.isArray(response?.entries)) return response.entries;
  return [];
}

function runTimestamp(raw: any): number {
  return Number(raw?.ts || raw?.runAtMs || raw?.startedAtMs || raw?.started_at_ms || 0);
}

function runStatus(raw: any): CronRunRecord["status"] {
  const status = String(raw?.status || raw?.lastStatus || "");
  if (["running", "ok", "error", "skipped", "timeout", "canceled"].includes(status)) return status as CronRunRecord["status"];
  return status === "success" ? "ok" : "error";
}

export function openClawRunToCronRunRecord(raw: any, jobId: string): CronRunRecord {
  const startedMs = runTimestamp(raw) || Date.now();
  const durationMs = typeof raw?.durationMs === "number" ? raw.durationMs : typeof raw?.duration_ms === "number" ? raw.duration_ms : undefined;
  return {
    id: String(raw?.id || raw?.runId || `${jobId}:${startedMs}`),
    jobId,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: durationMs != null ? new Date(startedMs + durationMs).toISOString() : undefined,
    durationMs,
    status: runStatus(raw),
    errorMessage: raw?.error ? String(raw.error) : raw?.lastError ? String(raw.lastError) : undefined,
    output: raw?.summary ? String(raw.summary) : raw?.output ? String(raw.output) : undefined,
    deliveryStatus: raw?.deliveryStatus === "ok" ? "ok" : raw?.deliveryStatus === "failed" ? "failed" : raw?.deliveryStatus === "skipped" ? "skipped" : undefined,
    deliveryTargetMasked: raw?.deliveryTargetMasked ? String(raw.deliveryTargetMasked) : undefined,
    triggeredBy: raw?.manual ? "manual" : "schedule",
    triggeredByUser: typeof raw?.triggeredByUser === "number" ? raw.triggeredByUser : undefined,
  };
}

function defaultTimezone() {
  return process.env.TZ || "Asia/Shanghai";
}

function previewOnce(schedule: Extract<CronSchedule, { kind: "once" }>, now: Date) {
  const run = new Date(schedule.runAt);
  return Number.isFinite(run.getTime()) && run.getTime() > now.getTime() ? [run] : [];
}

function previewInterval(schedule: Extract<CronSchedule, { kind: "interval" }>, now: Date, count: number) {
  const runs: Date[] = [];
  const stepMs = schedule.intervalMinutes * 60_000;
  let cursor = new Date(now.getTime() + stepMs);
  for (let i = 0; i < count; i++) {
    runs.push(cursor);
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return runs;
}

function previewCron(schedule: Extract<CronSchedule, { kind: "cron" }>, timezone: string, count: number) {
  const cron = new Cron(schedule.cronExpr, { timezone, paused: true });
  const next = cron.nextRuns(count);
  return next.map((value) => value instanceof Date ? value : new Date(value));
}

export function computePreviewRuns(request: PreviewRunsRequest, now = new Date()): PreviewRunsResponse {
  const count = Math.max(1, Math.min(20, Number(request.count || 5)));
  const timezone = request.timezone || defaultTimezone();
  let dates: Date[];
  if (request.schedule.kind === "once") {
    dates = previewOnce(request.schedule, now).slice(0, count);
  } else if (request.schedule.kind === "interval") {
    dates = previewInterval(request.schedule, now, count);
  } else {
    dates = previewCron(request.schedule, timezone, count);
  }
  const wakeOffsetMs = Number(request.wakeOffsetSeconds || 0) * 1000;
  return {
    runs: dates.map((runAt) => ({
      runAt: runAt.toISOString(),
      ...(wakeOffsetMs > 0 ? { wakeAt: new Date(runAt.getTime() - wakeOffsetMs).toISOString() } : {}),
    })),
  };
}

export class OpenClawCronProvider implements CronProvider {
  readonly runtime = "openclaw";
  private readonly runtimeClient: RuntimeRpc;
  private readonly getBoundChannelsForHandle: (handle: CronProviderHandle) => Promise<ChannelId[]>;
  private readonly getWeixinStatusForAdopt: NonNullable<OpenClawCronProviderOptions["getWeixinStatus"]>;
  private readonly now: () => Date;

  constructor(options: OpenClawCronProviderOptions = {}) {
    this.runtimeClient = options.runtime || createOpenClawRuntimeAdapter();
    this.getBoundChannelsForHandle = options.getBoundChannels || ((handle) => getUserBoundChannels(handle.userId, handle.adoptId));
    this.getWeixinStatusForAdopt = options.getWeixinStatus || getWeixinStatus;
    this.now = options.now || (() => new Date());
  }

  capabilities(): CronProviderCapabilities {
    return OPENCLAW_CRON_CAPABILITIES;
  }

  private deliveryForTarget(handle: CronProviderHandle, target: CronDeliveryTarget): CronResult<{
    rawDelivery: Record<string, any>;
    deliveryManagedBy: "openclaw-native" | "lingxia-sidecar";
  }> {
    if (target.channelId === "wechat") {
      const status = this.getWeixinStatusForAdopt(handle.adoptId);
      if (!status.bound || status.needsReactivation) {
        return validationFailed("wechat is not active; please bind or reactivate it in 频道页 first");
      }
      if (!status.accountId || !status.userId) {
        return validationFailed("wechat binding is missing OpenClaw accountId or userId");
      }
      return ok({
        rawDelivery: {
          mode: "announce",
          channel: "openclaw-weixin",
          accountId: status.accountId,
          to: status.userId,
        },
        deliveryManagedBy: "openclaw-native",
      });
    }

    // Feishu delivery is still handled by Lingxia's sidecar dispatcher until the
    // OpenClaw native channel contract is verified for that provider.
    return ok({
      rawDelivery: { mode: "none" },
      deliveryManagedBy: "lingxia-sidecar",
    });
  }

  async listJobs(handle: CronProviderHandle): Promise<CronResult<CronJob[]>> {
    try {
      const response = this.runtimeClient.callRpc("cron.list", { includeDisabled: true });
      const rawJobs = Array.isArray((response as any)?.jobs) ? (response as any).jobs : [];
      const jobs: CronJob[] = [];
      for (const raw of rawJobs) {
        if (String(raw?.agentId || "") !== handle.agentId) continue;
        try {
          jobs.push(openClawJobToCronJob(raw, handle));
        } catch (error: any) {
          console.warn("[CRON-PROVIDER] skip malformed OpenClaw job", {
            jobId: raw?.id,
            agentId: raw?.agentId,
            error: error?.message || String(error),
          });
        }
      }
      return ok(jobs);
    } catch (error: any) {
      return runtimeUnavailable(`cron.list failed: ${error?.message || error}`);
    }
  }

  async addJob(handle: CronProviderHandle, input: CronJobInput): Promise<CronResult<CronJob>> {
    const caps = this.capabilities();
    if (!caps.scheduleKinds.includes(input.schedule.kind)) {
      return validationFailed(`schedule kind ${input.schedule.kind} is not supported by OpenClaw`);
    }
    const target = input.delivery.targets[0];
    if (!target) return validationFailed("delivery target is required");
    if (!caps.supportedChannels.includes(target.channelId)) {
      return validationFailed(`OpenClaw cron does not support channel ${target.channelId}`);
    }
    const bound = await this.getBoundChannelsForHandle(handle);
    if (!bound.includes(target.channelId)) {
      return validationFailed(`channel ${target.channelId} is not bound; please bind it in 频道页 first`);
    }
    if (caps.promptRequired && !input.prompt?.trim()) {
      return validationFailed("prompt is required for OpenClaw cron jobs");
    }

    const delivery = this.deliveryForTarget(handle, target);
    if (!delivery.ok) return delivery;

    try {
      const payload = {
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        enabled: input.enabled !== false,
        schedule: openClawScheduleFromCronSchedule(input.schedule),
        payload: { kind: "agentTurn", message: input.prompt || "" },
        sessionTarget: input.meta?.sessionTarget || "isolated",
        delivery: delivery.value.rawDelivery,
        agentId: handle.agentId,
      };
      const response = this.runtimeClient.callRpc("cron.add", payload);
      const rawJob = {
        ...((response as any)?.job || response),
        delivery: ((response as any)?.job || response)?.delivery || payload.delivery,
      };
      const job = openClawJobToCronJob(rawJob, handle);
      job.meta = { ...(job.meta || {}), deliveryManagedBy: delivery.value.deliveryManagedBy };
      return ok(job);
    } catch (error: any) {
      return runtimeUnavailable(`cron.add failed: ${error?.message || error}`);
    }
  }

  async updateJob(handle: CronProviderHandle, id: string, patch: Partial<CronJobInput>): Promise<CronResult<CronJob>> {
    try {
      const rawPatch: Record<string, any> = {};
      let deliveryManagedBy: "openclaw-native" | "lingxia-sidecar" | undefined;
      if (patch.name !== undefined) rawPatch.name = patch.name;
      if (patch.description !== undefined) rawPatch.description = patch.description;
      if (patch.enabled !== undefined) rawPatch.enabled = patch.enabled;
      if (patch.schedule !== undefined) rawPatch.schedule = openClawScheduleFromCronSchedule(patch.schedule);
      if (patch.prompt !== undefined) rawPatch.payload = { kind: "agentTurn", message: patch.prompt };
      if (patch.delivery !== undefined) {
        const target = patch.delivery.targets[0];
        if (!target) return validationFailed("delivery target is required");
        const delivery = this.deliveryForTarget(handle, target);
        if (!delivery.ok) return delivery;
        rawPatch.delivery = delivery.value.rawDelivery;
        deliveryManagedBy = delivery.value.deliveryManagedBy;
      }
      const response = this.runtimeClient.callRpc("cron.update", { id, patch: rawPatch });
      const rawJob = {
        ...((response as any)?.job || response),
        ...(rawPatch.delivery && !((response as any)?.job || response)?.delivery ? { delivery: rawPatch.delivery } : {}),
      };
      const job = openClawJobToCronJob(rawJob, handle);
      if (deliveryManagedBy) job.meta = { ...(job.meta || {}), deliveryManagedBy };
      return ok(job);
    } catch (error: any) {
      return runtimeUnavailable(`cron.update failed: ${error?.message || error}`);
    }
  }

  async removeJob(_handle: CronProviderHandle, id: string): Promise<CronResult<void>> {
    try {
      this.runtimeClient.callRpc("cron.remove", { id });
      return ok(undefined);
    } catch (error: any) {
      return runtimeUnavailable(`cron.remove failed: ${error?.message || error}`);
    }
  }

  async runJobNow(_handle: CronProviderHandle, id: string): Promise<CronResult<{ runId: string }>> {
    try {
      const response = this.runtimeClient.callRpc("cron.run", { id, mode: "force" });
      return ok({ runId: String((response as any)?.runId || (response as any)?.id || id) });
    } catch (error: any) {
      return runtimeUnavailable(`cron.run failed: ${error?.message || error}`);
    }
  }

  async listRuns(_handle: CronProviderHandle, id: string, limit: number): Promise<CronResult<CronRunRecord[]>> {
    try {
      const response = this.runtimeClient.callRpc("cron.runs", { id, limit });
      const runs = rawRunsFromResponse(response).map((raw) => openClawRunToCronRunRecord(raw, id));
      return ok(runs);
    } catch (error: any) {
      return runtimeUnavailable(`cron.runs failed: ${error?.message || error}`);
    }
  }

  async previewRuns(request: PreviewRunsRequest): Promise<CronResult<PreviewRunsResponse>> {
    try {
      return ok(computePreviewRuns(request, this.now()));
    } catch (error: any) {
      return validationFailed(`preview failed: ${error?.message || error}`);
    }
  }
}
