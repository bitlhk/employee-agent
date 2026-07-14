import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  activeCronRunWatcherCount,
  findManualRunByRunId,
  parseManualRunTimestamp,
  resetCronRunWatchersForTest,
  startCronRunWatcher,
} from "./cron-run-watcher";

function runtimeStub(runs: unknown[]) {
  return {
    callRpc: vi.fn(() => ({ runs })),
  };
}

describe("cron run watcher matching", () => {
  beforeEach(() => {
    resetCronRunWatchersForTest();
  });

  it("parses the enqueue timestamp embedded in OpenClaw manual run ids", () => {
    expect(parseManualRunTimestamp("manual:job-1:1777538124049:1")).toBe(1777538124049);
    expect(parseManualRunTimestamp("bad")).toBeNull();
  });

  it("matches manual runs by jobId and runAtMs because OpenClaw runs omit runId", () => {
    const run = findManualRunByRunId({
      jobId: "job-1",
      runId: "manual:job-1:1777538124049:1",
      startedAtMs: 1777538123000,
      runs: [
        { jobId: "job-2", runAtMs: 1777538124049, status: "ok" },
        { jobId: "job-1", runAtMs: 1777538100000, status: "ok" },
        { jobId: "job-1", runAtMs: 1777538124051, status: "ok" },
      ],
    });
    expect(run?.jobId).toBe("job-1");
    expect(run?.runAtMs).toBe(1777538124051);
  });
});

describe("cron run watcher delivery", () => {
  beforeEach(() => {
    resetCronRunWatchersForTest();
  });

  it("delivers a completed manual run once and clears the active watcher", async () => {
    const deliver = vi.fn(async () => ({ ok: true }));
    const runtime = runtimeStub([
      { jobId: "job-1", runAtMs: 1777538124051, ts: 1777538179731, status: "ok", summary: "天气结果" },
    ]);

    await startCronRunWatcher({
      adoptId: "lgc-test",
      jobId: "job-1",
      jobName: "天气测试",
      runId: "manual:job-1:1777538124049:1",
      startedAtMs: 1777538123000,
    }, {
      runtime,
      deliver,
      timeoutMs: 50,
      pollIntervalMs: 1,
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      adoptId: "lgc-test",
      jobId: "job-1",
      jobName: "天气测试",
      runTs: 1777538179731,
      summary: "天气结果",
    });
    expect(activeCronRunWatcherCount()).toBe(0);
  });

  it("does not start duplicate watchers for the same job", async () => {
    const deliver = vi.fn(async () => ({ ok: true }));
    const runtime = runtimeStub([]);

    const first = startCronRunWatcher({
      adoptId: "lgc-test",
      jobId: "job-1",
      jobName: "天气测试",
      runId: "manual:job-1:1777538124049:1",
      startedAtMs: 1777538123000,
    }, {
      runtime,
      deliver,
      timeoutMs: 10,
      pollIntervalMs: 2,
    });

    const second = startCronRunWatcher({
      adoptId: "lgc-test",
      jobId: "job-1",
      jobName: "天气测试",
      runId: "manual:job-1:1777538124050:2",
      startedAtMs: 1777538123000,
    }, {
      runtime,
      deliver,
      timeoutMs: 10,
      pollIntervalMs: 2,
    });

    expect(second).toBe(first);
    await first;
    expect(deliver).not.toHaveBeenCalled();
    expect(activeCronRunWatcherCount()).toBe(0);
  });
});
