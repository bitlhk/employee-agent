import { createHash, randomBytes } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { and, count, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditEvents, auditExports } from "../../drizzle/schema";
import { APP_ROOT } from "./helpers";
import { auditActor, auditErrorMetadata, auditRequest, recordAuditRequired } from "../_core/audit-events";

const EXPORT_DIR = path.join(APP_ROOT, "data", "audit-exports");
const EXPORT_TTL_MS = Number(process.env.AUDIT_EXPORT_TTL_MS || 24 * 60 * 60 * 1000);
const MAX_EXPORT_ROWS = Number(process.env.AUDIT_EXPORT_MAX_ROWS || 10000);

const auditFilterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  action: z.string().trim().min(1).max(128).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  actorUserId: z.number().int().positive().optional(),
  targetId: z.string().trim().min(1).max(128).optional(),
  agentInstanceId: z.string().trim().min(1).max(128).optional(),
  result: z.enum(["success", "failed", "denied", "warning"]).optional(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
  q: z.string().trim().min(1).max(128).optional(),
});

const auditListSchema = auditFilterSchema.extend({
  page: z.number().int().min(1).max(500).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

function buildConditions(input: z.infer<typeof auditFilterSchema>) {
  const conditions = [];
  if (input.from) conditions.push(gte(auditEvents.eventTime, new Date(input.from)));
  if (input.to) conditions.push(lte(auditEvents.eventTime, new Date(input.to)));
  if (input.action) conditions.push(eq(auditEvents.action, input.action));
  if (input.category) conditions.push(eq(auditEvents.category, input.category));
  if (input.actorUserId) conditions.push(eq(auditEvents.actorUserId, input.actorUserId));
  if (input.targetId) conditions.push(eq(auditEvents.targetId, input.targetId));
  if (input.agentInstanceId) conditions.push(eq(auditEvents.agentInstanceId, input.agentInstanceId));
  if (input.result) conditions.push(eq(auditEvents.result, input.result));
  if (input.severity) conditions.push(eq(auditEvents.severity, input.severity));
  if (input.q) {
    const pattern = `%${input.q.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(or(
      like(auditEvents.eventId, pattern),
      like(auditEvents.action, pattern),
      like(auditEvents.actorEmail, pattern),
      like(auditEvents.targetName, pattern),
      like(auditEvents.resourceName, pattern),
    ));
  }
  return conditions.length ? and(...conditions) : undefined;
}

function toPublicEvent(row: typeof auditEvents.$inferSelect) {
  return {
    eventId: row.eventId,
    eventTime: row.eventTime,
    category: row.category,
    action: row.action,
    result: row.result,
    severity: row.severity,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    agentInstanceId: row.agentInstanceId,
    runtimeType: row.runtimeType,
    runtimeAgentId: row.runtimeAgentId,
    requestId: row.requestId,
    correlationId: row.correlationId,
    ip: row.ip,
    errorCode: row.errorCode,
    policyCode: row.policyCode,
    riskType: row.riskType,
    channel: row.channel,
    toolName: row.toolName,
    metadataJson: row.metadataJson,
    metadataTruncated: row.metadataTruncated,
  };
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeExport(rows: Array<typeof auditEvents.$inferSelect>, format: "csv" | "json") {
  const publicRows = rows.map(toPublicEvent);
  if (format === "json") return `${JSON.stringify(publicRows, null, 2)}\n`;
  const columns: Array<keyof ReturnType<typeof toPublicEvent>> = [
    "eventId", "eventTime", "category", "action", "result", "severity", "actorType", "actorUserId",
    "actorEmail", "actorRole", "targetType", "targetId", "targetName", "resourceType", "resourceId",
    "resourceName", "agentInstanceId", "runtimeType", "runtimeAgentId", "requestId", "correlationId",
    "ip", "errorCode", "policyCode", "riskType", "channel", "toolName", "metadataTruncated", "metadataJson",
  ];
  return [
    columns.join(","),
    ...publicRows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n") + "\n";
}

function createExportId() {
  return `audexp_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

function fileHash(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export const auditRouter = router({
  listEvents: adminProcedure
    .input(auditListSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      const where = buildConditions(input);
      const offset = (input.page - 1) * input.pageSize;
      const [totalRow] = await db.select({ total: count() }).from(auditEvents).where(where);
      const rows = await db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.eventTime), desc(auditEvents.id))
        .limit(input.pageSize)
        .offset(offset);
      return {
        rows: rows.map(toPublicEvent),
        total: Number(totalRow?.total || 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  listExports: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
    const rows = await db.select().from(auditExports).orderBy(desc(auditExports.createdAt)).limit(50);
    return rows.map((row) => ({
      exportId: row.exportId,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      filtersJson: row.filtersJson,
      format: row.format,
      rowCount: row.rowCount,
      fileHash: row.fileHash,
      fileSizeBytes: row.fileSizeBytes,
      encrypted: row.encrypted,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      downloadUrl: `/api/audit/exports/${encodeURIComponent(row.exportId)}/download`,
    }));
  }),

  createExport: adminProcedure
    .input(auditFilterSchema.extend({ format: z.enum(["csv", "json"]).default("csv") }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });

      const exportId = createExportId();
      await recordAuditRequired({
        action: "audit.export.requested",
        ...auditActor(ctx.user),
        ...auditRequest(ctx.req),
        targetType: "audit_export",
        targetId: exportId,
        metadata: { format: input.format, filters: input },
      });

      try {
        const where = buildConditions(input);
        const rows = await db
          .select()
          .from(auditEvents)
          .where(where)
          .orderBy(desc(auditEvents.eventTime), desc(auditEvents.id))
          .limit(MAX_EXPORT_ROWS);
        const content = serializeExport(rows, input.format);
        const hash = fileHash(content);
        const fileSizeBytes = Buffer.byteLength(content, "utf8");
        const storageKey = `${exportId}.${input.format}`;
        const filePath = path.join(EXPORT_DIR, storageKey);
        const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);

        await mkdir(EXPORT_DIR, { recursive: true });
        await writeFile(filePath, content, "utf8");
        await db.insert(auditExports).values({
          exportId,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email || null,
          filtersJson: input,
          format: input.format,
          rowCount: rows.length,
          storageKey,
          fileHash: hash,
          fileSizeBytes,
          encrypted: false,
          expiresAt,
        });

        await recordAuditRequired({
          action: "audit.export.completed",
          ...auditActor(ctx.user),
          ...auditRequest(ctx.req),
          targetType: "audit_export",
          targetId: exportId,
          metadata: {
            format: input.format,
            rowCount: rows.length,
            fileSizeBytes,
            fileHash: hash,
            storageKey,
            expiresAt: expiresAt.toISOString(),
          },
        });

        return {
          exportId,
          rowCount: rows.length,
          fileSizeBytes,
          fileHash: hash,
          expiresAt,
          downloadUrl: `/api/audit/exports/${encodeURIComponent(exportId)}/download`,
        };
      } catch (error) {
        try {
          await recordAuditRequired({
            action: "audit.export.failed",
            result: "failed",
            severity: "high",
            ...auditActor(ctx.user),
            ...auditRequest(ctx.req),
            targetType: "audit_export",
            targetId: exportId,
            errorCode: "AUDIT_EXPORT_FAILED",
            metadata: {
              format: input.format,
              filters: input,
              ...auditErrorMetadata(error),
            },
          });
        } catch (auditError) {
          console.error("[AUDIT-EXPORT] failed to record export failure", auditError);
        }
        throw error;
      }
    }),
});

export async function getAuditExportRecord(exportId: string) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = await db.select().from(auditExports).where(eq(auditExports.exportId, exportId)).limit(1);
  const record = rows[0];
  return record || null;
}

export async function getAuditExportFile(exportId: string) {
  const record = await getAuditExportRecord(exportId);
  if (!record) return null;
  const filePath = path.join(EXPORT_DIR, record.storageKey);
  const [file, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
  const hash = fileHash(file);
  if (hash !== record.fileHash) throw new Error("audit export hash mismatch");
  if (Number(fileStat.size) !== Number(record.fileSizeBytes)) throw new Error("audit export size mismatch");
  return { record, filePath };
}
