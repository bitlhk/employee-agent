import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import { APP_ROOT, normalizeOpenClawHome } from "../helpers";
import type {
  OpenClawArtifactLookup,
  OpenClawRuntimeId,
  OpenClawSessionId,
  OpenClawSessionIndex,
  OpenClawSessionKey,
  OpenClawTraceArtifactEvent,
} from "./types";

const DEFAULT_MAX_TRAJ_FULL_READ = 10 * 1024 * 1024;
const DEFAULT_TAIL_READ_SIZE = 5 * 1024 * 1024;
const DEFAULT_ARTIFACT_WINDOW_MS = 15 * 60 * 1000;

export interface OpenClawRuntimeAdapterOptions {
  remoteHome?: string;
  maxTrajectoryFullReadBytes?: number;
  trajectoryTailReadBytes?: number;
}

export class OpenClawRuntimeAdapter {
  readonly remoteHome: string;
  readonly maxTrajectoryFullReadBytes: number;
  readonly trajectoryTailReadBytes: number;

  constructor(options: OpenClawRuntimeAdapterOptions = {}) {
    this.remoteHome = normalizeOpenClawHome(options.remoteHome);
    this.maxTrajectoryFullReadBytes = options.maxTrajectoryFullReadBytes || DEFAULT_MAX_TRAJ_FULL_READ;
    this.trajectoryTailReadBytes = options.trajectoryTailReadBytes || DEFAULT_TAIL_READ_SIZE;
  }

  resolveMainSessionKey(params: {
    adoptId: string;
    runtimeAgentId: OpenClawRuntimeId;
    epoch: number;
    epochLabel?: string;
  }): OpenClawSessionKey {
    if (params.epochLabel && typeof params.epochLabel === "string" && params.epochLabel.trim().length > 0) {
      const safeLabel = params.epochLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      return `agent:${params.runtimeAgentId}:main:${safeLabel}`;
    }
    const found = this.lookupSessionRegistry(params.adoptId, params.runtimeAgentId, params.epoch);
    if (found) return found;
    return params.epoch > 0
      ? `agent:${params.runtimeAgentId}:main:e${params.epoch}`
      : `agent:${params.runtimeAgentId}:main`;
  }

  sessionRegistryPath(): string {
    return `${APP_ROOT}/data/claw-session-registry.json`;
  }

  lookupSessionRegistry(adoptId: string, runtimeAgentId: string, currentEpoch: number): string | null {
    try {
      const path = this.sessionRegistryPath();
      if (!existsSync(path)) return null;
      const registry = JSON.parse(readFileSync(path, "utf8") || "{}") || {};
      const entry = registry[`${adoptId}:${runtimeAgentId}`];
      if (!entry) return null;
      if (Number(entry.skillEpoch) !== currentEpoch) return null;
      const sessionKey = String(entry.sessionKey || "");
      return sessionKey || null;
    } catch {
      return null;
    }
  }

  agentDir(runtimeAgentId: OpenClawRuntimeId): string {
    return `${this.remoteHome}/agents/${runtimeAgentId}`;
  }

  sessionsDir(runtimeAgentId: OpenClawRuntimeId): string {
    return `${this.agentDir(runtimeAgentId)}/sessions`;
  }

  sessionsIndexPath(runtimeAgentId: OpenClawRuntimeId): string {
    return `${this.sessionsDir(runtimeAgentId)}/sessions.json`;
  }

  trajectoryPath(runtimeAgentId: OpenClawRuntimeId, sessionId: OpenClawSessionId): string {
    return `${this.sessionsDir(runtimeAgentId)}/${sessionId}.trajectory.jsonl`;
  }

  readSessionIndex(runtimeAgentId: OpenClawRuntimeId): { ok: true; data: OpenClawSessionIndex } | { ok: false; reason: "sessions_json_missing" | "sessions_json_unreadable" } {
    const path = this.sessionsIndexPath(runtimeAgentId);
    if (!existsSync(path)) return { ok: false, reason: "sessions_json_missing" };
    try {
      return { ok: true, data: JSON.parse(readFileSync(path, "utf8")) || {} };
    } catch {
      return { ok: false, reason: "sessions_json_unreadable" };
    }
  }

  getSessionId(runtimeAgentId: OpenClawRuntimeId, sessionKey: OpenClawSessionKey): { ok: true; sessionId: OpenClawSessionId } | { ok: false; reason: "sessions_json_missing" | "sessions_json_unreadable" | "no_session_yet" } {
    const index = this.readSessionIndex(runtimeAgentId);
    if (!index.ok) return index;
    const sessionId = index.data?.[sessionKey]?.sessionId;
    if (!sessionId || typeof sessionId !== "string") return { ok: false, reason: "no_session_yet" };
    return { ok: true, sessionId };
  }

  readTrajectoryText(runtimeAgentId: OpenClawRuntimeId, sessionId: OpenClawSessionId): { ok: true; text: string } | { ok: false; reason: "trajectory_missing" } {
    const path = this.trajectoryPath(runtimeAgentId, sessionId);
    if (!existsSync(path)) return { ok: false, reason: "trajectory_missing" };

    const stat = statSync(path);
    if (stat.size <= this.maxTrajectoryFullReadBytes) {
      return { ok: true, text: readFileSync(path, "utf8") };
    }

    const fd = openSync(path, "r");
    try {
      const readSize = Math.min(this.trajectoryTailReadBytes, stat.size);
      const buf = Buffer.alloc(readSize);
      readSync(fd, buf, 0, readSize, stat.size - readSize);
      const text = buf.toString("utf8");
      const firstNewline = text.indexOf("\n");
      return { ok: true, text: firstNewline >= 0 ? text.slice(firstNewline + 1) : text };
    } finally {
      closeSync(fd);
    }
  }

  parseCapturedAt(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const t = new Date(raw).getTime();
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  }

  findFirstArtifactAfter(params: {
    runtimeAgentId: OpenClawRuntimeId;
    sessionKey: OpenClawSessionKey;
    streamEndMs: number;
    windowMs?: number;
  }): OpenClawArtifactLookup {
    const session = this.getSessionId(params.runtimeAgentId, params.sessionKey);
    if (!session.ok) return { status: "pending", reason: session.reason, sessionKey: params.sessionKey };

    const trajectory = this.readTrajectoryText(params.runtimeAgentId, session.sessionId);
    if (!trajectory.ok) {
      return { status: "pending", reason: trajectory.reason, sessionKey: params.sessionKey, sessionId: session.sessionId };
    }

    const winUpper = params.streamEndMs + (params.windowMs || DEFAULT_ARTIFACT_WINDOW_MS);
    let earliestArt: OpenClawTraceArtifactEvent | null = null;
    let earliestAt = Infinity;

    for (const line of trajectory.text.split("\n")) {
      if (!line) continue;
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (event?.type !== "trace.artifacts") continue;
      const at = this.parseCapturedAt(event?.data?.capturedAt);
      if (at <= params.streamEndMs || at > winUpper) continue;
      if (at < earliestAt) {
        earliestArt = event as OpenClawTraceArtifactEvent;
        earliestAt = at;
      }
    }

    if (!earliestArt) {
      return { status: "pending", reason: "no_artifacts_yet", sessionKey: params.sessionKey, sessionId: session.sessionId };
    }

    return {
      status: "found",
      sessionKey: params.sessionKey,
      sessionId: session.sessionId,
      artifact: earliestArt,
      capturedAtMs: earliestAt,
    };
  }

  callRpc<T = any>(method: string, params: Record<string, any> = {}): T {
    const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
    const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
    const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
    const url = `ws://${remoteHost}:${gatewayPort}`;
    const out = execFileSync("openclaw", [
      "gateway", "call", method,
      "--json",
      "--url", url,
      "--token", gatewayToken,
      "--timeout", "30000",
      "--params", JSON.stringify(params || {}),
    ], { encoding: "utf-8", timeout: 40000 });
    return JSON.parse(String(out || "{}").trim() || "{}") as T;
  }
}

export function createOpenClawRuntimeAdapter(options?: OpenClawRuntimeAdapterOptions) {
  return new OpenClawRuntimeAdapter(options);
}
