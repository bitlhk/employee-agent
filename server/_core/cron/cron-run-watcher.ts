import { createOpenClawRuntimeAdapter } from "../runtime";
import { deliverCronRunNow } from "../cron-delivery";

type RuntimeRpc = {
  callRpc<T = any>(method: string, params?: Record<string, any>): T;
};

type WatcherOptions = {
  runtime?: RuntimeRpc;
  deliver?: typeof deliverCronRunNow;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxConsecutiveErrors?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

const activeWatchers = new Map<string, Promise<void>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseManualRunTimestamp(runId: string): number | null {
  const parts = String(runId || "").split(":");
  const value = Number(parts[2] || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rawRuns(response: any): any[] {
  if (Array.isArray(response?.runs)) return response.runs;
  if (Array.isArray(response?.entries)) return response.entries;
  return [];
}

function runTs(run: any): number {
  return Number(run?.ts || run?.runAtMs || 0);
}

function runAtMs(run: any): number {
  return Number(run?.runAtMs || run?.ts || 0);
}

export function findManualRunByRunId(params: {
  runs: any[];
  jobId: string;
  runId: string;
  startedAtMs: number;
}): any | null {
  const expectedMs = parseManualRunTimestamp(params.runId);
  const candidates = params.runs.filter((run) => String(run?.jobId || "") === params.jobId);

  // Current OpenClaw 2026.4.26 cron.runs output does not include runId. The
  // manual runId embeds the enqueue timestamp, so we match on jobId + runAtMs
  // within a narrow window and only after this request started.
  if (expectedMs) {
    const matched = candidates.find((run) => {
      const at = runAtMs(run);
      return at >= params.startedAtMs - 1_000 && Math.abs(at - expectedMs) <= 5_000;
    });
    if (matched) return matched;
  }

  return candidates.find((run) => runAtMs(run) >= params.startedAtMs - 1_000) || null;
}

export function startCronRunWatcher(params: {
  adoptId: string;
  jobId: string;
  jobName: string;
  runId: string;
  startedAtMs?: number;
}, options: WatcherOptions = {}): Promise<void> {
  if (activeWatchers.has(params.jobId)) {
    console.log("[CRON-WATCHER] watcher already active for job", params.jobId);
    return activeWatchers.get(params.jobId)!;
  }

  const runtime = options.runtime || createOpenClawRuntimeAdapter();
  const deliver = options.deliver || deliverCronRunNow;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const startedAtMs = params.startedAtMs || Date.now();

  const task = (async () => {
    let consecutiveErrors = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = runtime.callRpc("cron.runs", { id: params.jobId, limit: 10 });
        const run = findManualRunByRunId({
          runs: rawRuns(response),
          jobId: params.jobId,
          runId: params.runId,
          startedAtMs,
        });
        if (run && ["ok", "error", "skipped", "timeout", "canceled"].includes(String(run.status || ""))) {
          if (String(run.status) === "ok" && run.summary) {
            await deliver({
              adoptId: params.adoptId,
              jobId: params.jobId,
              jobName: params.jobName,
              runTs: runTs(run),
              summary: String(run.summary),
            });
          } else {
            console.log("[CRON-WATCHER] manual run finished without delivery", {
              jobId: params.jobId,
              runId: params.runId,
              status: run.status,
            });
          }
          return;
        }
        consecutiveErrors = 0;
      } catch (error: any) {
        consecutiveErrors += 1;
        console.warn("[CRON-WATCHER] poll failed", {
          jobId: params.jobId,
          runId: params.runId,
          consecutiveErrors,
          error: error?.message || String(error),
        });
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.warn("[CRON-WATCHER] giving up after consecutive errors; poller will take over", {
            jobId: params.jobId,
            runId: params.runId,
          });
          return;
        }
      }
      await sleep(pollIntervalMs);
    }
    console.log("[CRON-WATCHER] timeout; handing off to poller", {
      jobId: params.jobId,
      runId: params.runId,
      timeoutMs,
    });
  })().finally(() => {
    if (activeWatchers.get(params.jobId) === task) activeWatchers.delete(params.jobId);
  });

  activeWatchers.set(params.jobId, task);
  return task;
}

export function activeCronRunWatcherCount() {
  return activeWatchers.size;
}

export function resetCronRunWatchersForTest() {
  activeWatchers.clear();
}
