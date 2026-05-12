import { describe, expect, it, vi } from "vitest";
import type { CronJobInput, CronProviderHandle } from "@shared/types/cron";
import {
  computePreviewRuns,
  openClawJobToCronJob,
  openClawScheduleFromCronSchedule,
  OpenClawCronProvider,
} from "./openclaw-cron-provider";

const handle: CronProviderHandle = {
  adoptId: "lgc-test",
  agentId: "trial_lgc-test",
  userId: 2,
  runtime: "openclaw",
};

function runtimeStub(responses: Record<string, unknown>) {
  return {
    callRpc: vi.fn((method: string) => responses[method] ?? {}),
  };
}

describe("OpenClawCronProvider schedule mapping", () => {
  it("maps once to OpenClaw at schedule", () => {
    expect(openClawScheduleFromCronSchedule({ kind: "once", runAt: "2026-05-01T01:00:00.000Z", display: "2026-05-01 09:00" })).toEqual({
      kind: "at",
      at: "2026-05-01T01:00:00.000Z",
    });
  });

  it("maps interval to everyMs", () => {
    expect(openClawScheduleFromCronSchedule({ kind: "interval", intervalMinutes: 30, display: "每 30 分钟" })).toEqual({
      kind: "every",
      everyMs: 1_800_000,
    });
  });

  it("maps cron to expr", () => {
    expect(openClawScheduleFromCronSchedule({ kind: "cron", cronExpr: "0 9 * * *", display: "每天 9 点" })).toEqual({
      kind: "cron",
      expr: "0 9 * * *",
    });
  });
});

describe("OpenClawCronProvider previewRuns", () => {
  it("does not return expired once schedules", () => {
    const result = computePreviewRuns({
      adoptId: "lgc-test",
      schedule: { kind: "once", runAt: "2026-04-01T00:00:00.000Z", display: "past" },
      count: 5,
    }, new Date("2026-04-30T00:00:00.000Z"));
    expect(result.runs).toEqual([]);
  });

  it("returns interval previews from now", () => {
    const result = computePreviewRuns({
      adoptId: "lgc-test",
      schedule: { kind: "interval", intervalMinutes: 15, display: "每 15 分钟" },
      count: 2,
    }, new Date("2026-04-30T00:00:00.000Z"));
    expect(result.runs.map((r) => r.runAt)).toEqual([
      "2026-04-30T00:15:00.000Z",
      "2026-04-30T00:30:00.000Z",
    ]);
  });
});

describe("OpenClawCronProvider validation and reads", () => {
  const input: CronJobInput = {
    name: "每日晨报",
    prompt: "生成金融晨报",
    schedule: { kind: "cron", cronExpr: "0 9 * * *", display: "每天 9 点" },
    delivery: { targets: [{ channelId: "feishu", channelLabel: "飞书" }] },
  };

  it("rejects addJob when channel is not bound", async () => {
    const runtime = runtimeStub({});
    const provider = new OpenClawCronProvider({ runtime, getBoundChannels: async () => ["wechat"] });
    const result = await provider.addJob(handle, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation_failed");
    expect(runtime.callRpc).not.toHaveBeenCalled();
  });

  it("calls cron.add after shared channel validation passes", async () => {
    const runtime = runtimeStub({
      "cron.add": {
        id: "job-1",
        agentId: "trial_lgc-test",
        name: "每日晨报",
        enabled: true,
        createdAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
        updatedAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
        schedule: { kind: "cron", expr: "0 9 * * *" },
        payload: { kind: "agentTurn", message: "生成金融晨报" },
        delivery: { mode: "none" },
        state: {},
      },
    });
    const provider = new OpenClawCronProvider({ runtime, getBoundChannels: async () => ["feishu"] });
    const result = await provider.addJob(handle, input);
    expect(result.ok).toBe(true);
    expect(runtime.callRpc).toHaveBeenCalledWith("cron.add", expect.objectContaining({
      schedule: { kind: "cron", expr: "0 9 * * *" },
      delivery: { mode: "none" },
      agentId: "trial_lgc-test",
    }));
  });

  it("listRuns is read-only and only calls cron.runs", async () => {
    const runtime = runtimeStub({
      "cron.runs": { runs: [{ id: "run-1", ts: Date.parse("2026-04-30T00:00:00.000Z"), status: "ok", summary: "done" }] },
    });
    const provider = new OpenClawCronProvider({ runtime, getBoundChannels: async () => ["wechat"] });
    const result = await provider.listRuns(handle, "job-1", 20);
    expect(result.ok).toBe(true);
    expect(runtime.callRpc).toHaveBeenCalledTimes(1);
    expect(runtime.callRpc).toHaveBeenCalledWith("cron.runs", { id: "job-1", limit: 20 });
  });

  it("returns only the new CronJob contract fields", () => {
    const job = openClawJobToCronJob({
      id: "job-1",
      agentId: "trial_lgc-test",
      name: "每半小时巡检",
      enabled: true,
      createdAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
      updatedAtMs: Date.parse("2026-04-30T00:01:00.000Z"),
      schedule: { kind: "every", everyMs: 1_800_000 },
      payload: { kind: "agentTurn", message: "检查天气" },
      delivery: { mode: "none", to: "conversation" },
      state: {
        nextRunAtMs: Date.parse("2026-04-30T00:30:00.000Z"),
        lastRunAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
        lastStatus: "ok",
      },
    }, handle);

    expect(job.schedule.kind).toBe("interval");
    expect(job.state.nextRunAt).toBe("2026-04-30T00:30:00.000Z");
    expect((job as any).scheduleKind).toBeUndefined();
    expect((job.state as any).nextRunAtMs).toBeUndefined();
    expect((job.delivery as any).mode).toBeUndefined();
    expect((job.delivery as any).weixin).toBeUndefined();
  });

  it("does not pretend missing delivery config is bound to wechat", () => {
    const job = openClawJobToCronJob({
      id: "job-no-delivery",
      agentId: "trial_lgc-test",
      name: "未配置投递任务",
      enabled: true,
      createdAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
      updatedAtMs: Date.parse("2026-04-30T00:01:00.000Z"),
      schedule: { kind: "cron", expr: "0 9 * * *" },
      payload: { kind: "agentTurn", message: "检查天气" },
      delivery: { mode: "none", to: "conversation" },
      state: {},
    }, handle);

    expect(job.delivery.targets).toEqual([]);
    expect((job.delivery as any).mode).toBeUndefined();
    expect((job.delivery as any).target).toBeUndefined();
    expect((job.delivery as any).weixin).toBeUndefined();
  });
});
