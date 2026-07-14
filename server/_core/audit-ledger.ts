import { randomBytes } from "crypto";
import { appendFile, mkdir, readdir, readFile, stat, statfs } from "fs/promises";
import path from "path";
import { getDb } from "../db";
import { auditEvents } from "../../drizzle/schema";

const METADATA_MAX_BYTES = 16 * 1024;
const DEFAULT_APP_ROOT = process.env.APP_ROOT || process.cwd();
const DEFAULT_DLQ_DIR = path.join(DEFAULT_APP_ROOT, "data", "audit-dlq");

const SECRET_KEY_RE = /password|token|secret|apiKey|cookie|authorization|credential|privateKey|gatewayToken|botToken/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;
const NATIONAL_ID_RE = /(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
const BANK_CARD_RE = /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g;

export const FAIL_CLOSE_AUDIT_ACTIONS = new Set([
  "audit.export.requested",
  "audit.export.completed",
  "audit.export.failed",
  "audit.export.downloaded",
  "admin.user.role_changed",
  "admin.user.access_changed",
  "admin.user.access_changed.requested",
  "admin.user.access_changed.completed",
  "admin.user.password_reset",
  "admin.user.password_reset.requested",
  "admin.user.password_reset.completed",
  "tenant.created",
  "tenant.deleted",
  "file.downloaded",
  "skill.market.approved",
  "skill.market.approved.requested",
  "skill.market.approved.completed",
  "config.security_critical_changed",
]);

export type AuditRecordMode = "sync" | "async" | "auto";
export type AuditRecordResultStatus = "persisted" | "dlq" | "queued" | "failed";

export type AuditEventResult = "success" | "failed" | "denied" | "warning";
export type AuditEventSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface AuditEventInput {
  eventId?: string;
  eventTime?: Date | string;
  category?: string;
  action: string;
  result?: AuditEventResult;
  severity?: AuditEventSeverity;
  actorType?: string;
  actorUserId?: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  actorOrgId?: string | null;
  actorDepartmentId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  workspaceId?: string | null;
  agentInstanceId?: string | null;
  runtimeType?: string | null;
  runtimeAgentId?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  source?: string;
  environment?: string | null;
  detailType?: string | null;
  detailId?: string | null;
  errorCode?: string | null;
  policyCode?: string | null;
  riskType?: string | null;
  channel?: string | null;
  toolName?: string | null;
  metadata?: unknown;
  mode?: AuditRecordMode;
}

export interface NormalizedAuditEvent {
  eventId: string;
  eventTime: Date;
  category: string;
  action: string;
  result: AuditEventResult;
  severity: AuditEventSeverity;
  actorType: string;
  actorUserId?: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  actorOrgId?: string | null;
  actorDepartmentId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  workspaceId?: string | null;
  agentInstanceId?: string | null;
  runtimeType?: string | null;
  runtimeAgentId?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  source: string;
  environment?: string | null;
  detailType?: string | null;
  detailId?: string | null;
  errorCode?: string | null;
  policyCode?: string | null;
  riskType?: string | null;
  channel?: string | null;
  toolName?: string | null;
  metadataJson: Record<string, unknown> | null;
  metadataTruncated: boolean;
  metadataOriginalBytes?: number | null;
}

export interface AuditRecordResult {
  eventId: string;
  status: AuditRecordResultStatus;
  persisted: boolean;
  dlqWritten: boolean;
  failClose: boolean;
  metadataTruncated: boolean;
  metadataOriginalBytes?: number | null;
  error?: string;
}

export interface AuditDlqStats {
  dir: string;
  exists: boolean;
  fileCount: number;
  eventCount: number;
  bytes: number;
  diskAvailableBytes?: number;
  diskTotalBytes?: number;
  newestFileMtime?: Date;
  lastWriteFailure?: string;
  lastDrainTime?: Date;
}

export interface AuditLedgerOptions {
  dlqDir?: string;
  insertAuditEvent?: (event: NormalizedAuditEvent) => Promise<void>;
  now?: () => Date;
  idFactory?: () => string;
}

export class AuditRecordError extends Error {
  constructor(
    message: string,
    readonly eventId: string,
    readonly causeError?: unknown,
  ) {
    super(message);
    this.name = "AuditRecordError";
  }
}

export function createAuditLedger(options: AuditLedgerOptions = {}) {
  const dlqDir = options.dlqDir || DEFAULT_DLQ_DIR;
  const insertAuditEvent = options.insertAuditEvent || insertAuditEventToDb;
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || createAuditEventId;

  async function persistWithDlq(event: NormalizedAuditEvent, failClose: boolean): Promise<AuditRecordResult> {
    try {
      await insertAuditEvent(event);
      return {
        eventId: event.eventId,
        status: "persisted",
        persisted: true,
        dlqWritten: false,
        failClose,
        metadataTruncated: event.metadataTruncated,
        metadataOriginalBytes: event.metadataOriginalBytes,
      };
    } catch (persistError) {
      try {
        await writeAuditDlq(event, persistError, dlqDir);
        return {
          eventId: event.eventId,
          status: "dlq",
          persisted: false,
          dlqWritten: true,
          failClose,
          metadataTruncated: event.metadataTruncated,
          metadataOriginalBytes: event.metadataOriginalBytes,
          error: errorMessage(persistError),
        };
      } catch (dlqError) {
        if (failClose) {
          throw new AuditRecordError(
            `fail-close audit event ${event.action} could not be persisted or written to DLQ`,
            event.eventId,
            { persistError, dlqError },
          );
        }
        return {
          eventId: event.eventId,
          status: "failed",
          persisted: false,
          dlqWritten: false,
          failClose,
          metadataTruncated: event.metadataTruncated,
          metadataOriginalBytes: event.metadataOriginalBytes,
          error: `${errorMessage(persistError)}; dlq: ${errorMessage(dlqError)}`,
        };
      }
    }
  }

  async function recordAuditEvent(input: AuditEventInput): Promise<AuditRecordResult> {
    const event = normalizeAuditEvent(input, now, idFactory);
    const failClose = FAIL_CLOSE_AUDIT_ACTIONS.has(event.action);
    const mode = input.mode || "auto";

    if (mode === "async" && !failClose) {
      persistWithDlq(event, false).catch((err) => {
        console.error("[AUDIT] async audit event failed:", err);
      });
      return {
        eventId: event.eventId,
        status: "queued",
        persisted: false,
        dlqWritten: false,
        failClose: false,
        metadataTruncated: event.metadataTruncated,
        metadataOriginalBytes: event.metadataOriginalBytes,
      };
    }

    return persistWithDlq(event, failClose);
  }

  return {
    dlqDir,
    recordAuditEvent,
    getDlqStats: () => getAuditDlqStats(dlqDir),
  };
}

export const auditLedger = createAuditLedger();
export const recordAuditEvent = auditLedger.recordAuditEvent;

export function normalizeAuditEvent(
  input: AuditEventInput,
  now: () => Date = () => new Date(),
  idFactory: () => string = createAuditEventId,
): NormalizedAuditEvent {
  if (!input.action || typeof input.action !== "string") {
    throw new Error("audit action is required");
  }

  const metadata = normalizeMetadata(input.metadata);
  return {
    eventId: input.eventId || idFactory(),
    eventTime: input.eventTime ? new Date(input.eventTime) : now(),
    category: input.category || categoryFromAction(input.action),
    action: input.action,
    result: input.result || "success",
    severity: input.severity || "info",
    actorType: input.actorType || "user",
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    actorOrgId: input.actorOrgId,
    actorDepartmentId: input.actorDepartmentId,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceName: input.resourceName,
    workspaceId: input.workspaceId,
    agentInstanceId: input.agentInstanceId,
    runtimeType: input.runtimeType,
    runtimeAgentId: input.runtimeAgentId,
    requestId: input.requestId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    ip: input.ip,
    userAgent: input.userAgent,
    source: input.source || "platform",
    environment: input.environment || process.env.NODE_ENV || null,
    detailType: input.detailType,
    detailId: input.detailId,
    errorCode: input.errorCode,
    policyCode: input.policyCode,
    riskType: input.riskType,
    channel: input.channel,
    toolName: input.toolName,
    metadataJson: metadata.value,
    metadataTruncated: metadata.truncated,
    metadataOriginalBytes: metadata.originalBytes,
  };
}

export function redactAuditMetadata(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export async function getAuditDlqStats(dir = DEFAULT_DLQ_DIR): Promise<AuditDlqStats> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let bytes = 0;
    let eventCount = 0;
    let newestFileMtime: Date | undefined;
    let lastWriteFailure: string | undefined;
    let lastDrainTime: Date | undefined;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, entry.name);
      const s = await stat(filePath);
      bytes += s.size;
      if (!newestFileMtime || s.mtime > newestFileMtime) newestFileMtime = s.mtime;
      const content = await readFile(filePath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        eventCount += 1;
        try {
          const parsed = JSON.parse(line);
          if (parsed?.type === "audit.dlq.write_failure") lastWriteFailure = parsed.error || "unknown";
          if (parsed?.type === "audit.dlq.drained" && parsed.ts) lastDrainTime = new Date(parsed.ts);
        } catch {
          lastWriteFailure = "dlq contains invalid jsonl";
        }
      }
    }

    const disk = await getDiskStats(dir);
    return {
      dir,
      exists: true,
      fileCount: entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).length,
      eventCount,
      bytes,
      diskAvailableBytes: disk?.availableBytes,
      diskTotalBytes: disk?.totalBytes,
      newestFileMtime,
      lastWriteFailure,
      lastDrainTime,
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { dir, exists: false, fileCount: 0, eventCount: 0, bytes: 0 };
    }
    throw err;
  }
}

async function getDiskStats(dir: string): Promise<{ availableBytes: number; totalBytes: number } | null> {
  try {
    const fsStats = await statfs(dir);
    return {
      availableBytes: Number(fsStats.bavail) * Number(fsStats.bsize),
      totalBytes: Number(fsStats.blocks) * Number(fsStats.bsize),
    };
  } catch {
    return null;
  }
}

async function insertAuditEventToDb(event: NormalizedAuditEvent): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL is not set or database is unavailable");
  await db.insert(auditEvents).values(event as any);
}

async function writeAuditDlq(event: NormalizedAuditEvent, error: unknown, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const line = JSON.stringify({
    type: "audit.event",
    ts: new Date().toISOString(),
    error: errorMessage(error),
    event,
  });
  await appendFile(file, `${line}\n`, "utf8");
}

function normalizeMetadata(metadata: unknown): {
  value: Record<string, unknown> | null;
  truncated: boolean;
  originalBytes?: number | null;
} {
  if (metadata === undefined || metadata === null) {
    return { value: null, truncated: false, originalBytes: null };
  }

  const redacted = redactAuditMetadata(metadata);
  const json = safeStringify(redacted);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= METADATA_MAX_BYTES) {
    return {
      value: asMetadataObject(redacted),
      truncated: false,
      originalBytes: null,
    };
  }

  return {
    value: {
      truncated: true,
      preview: json.slice(0, 2048),
    },
    truncated: true,
    originalBytes: bytes,
  };
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binary:${value.length}]`;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (typeof value !== "object") return String(value);

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactValue(item, seen);
  }
  return out;
}

function redactString(value: string): string {
  return value
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|token|secret|api[-_]?key|cookie|authorization|credential|private[-_]?key|gatewayToken|botToken)\s*[=:]\s*)(["']?)[^"'\s&]+/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:password|token|secret|api[-_]?key|cookie|authorization|credential|private[-_]?key|gatewayToken|botToken)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_RE, "[REDACTED_PHONE]")
    .replace(NATIONAL_ID_RE, "[REDACTED_ID]")
    .replace(BANK_CARD_RE, "[REDACTED_BANK_CARD]");
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function createAuditEventId(): string {
  const now = Date.now();
  const time = encodeCrockfordBase32(now, 10);
  const random = encodeCrockfordBase32(BigInt(`0x${randomBytes(10).toString("hex")}`), 16);
  return `${time}${random}`;
}

function encodeCrockfordBase32(value: number | bigint, minLength: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let n = BigInt(value);
  let out = "";
  const base = BigInt(32);
  do {
    out = alphabet[Number(n % base)] + out;
    n /= base;
  } while (n > BigInt(0));
  return out.padStart(minLength, "0");
}

function categoryFromAction(action: string): string {
  const first = action.split(".")[0]?.trim();
  return first || "system";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
