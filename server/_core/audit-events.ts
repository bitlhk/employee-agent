import type { Request } from "express";
import { getClientIp } from "./ip-utils";
import { FAIL_CLOSE_AUDIT_ACTIONS, recordAuditEvent, type AuditEventInput, type AuditRecordResult } from "./audit-ledger";

type AuditUser = {
  id?: number | string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  organization?: string | null;
  groupId?: number | string | null;
};

export function auditActor(user?: AuditUser | null): Pick<AuditEventInput, "actorType" | "actorUserId" | "actorName" | "actorEmail" | "actorRole" | "actorOrgId" | "actorDepartmentId"> {
  if (!user) return { actorType: "anonymous" };
  return {
    actorType: "user",
    actorUserId: user.id === undefined || user.id === null ? null : Number(user.id),
    actorName: user.name || null,
    actorEmail: user.email || null,
    actorRole: user.role || null,
    actorOrgId: user.organization || null,
    actorDepartmentId: user.groupId === undefined || user.groupId === null ? null : String(user.groupId),
  };
}

export function auditRequest(req?: Request | null): Pick<AuditEventInput, "ip" | "userAgent" | "requestId"> {
  if (!req) return {};
  const requestId = String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim();
  return {
    ip: getClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 1000) || null,
    requestId: requestId || null,
  };
}

export async function recordAuditBestEffort(input: AuditEventInput): Promise<AuditRecordResult | null> {
  if (FAIL_CLOSE_AUDIT_ACTIONS.has(input.action)) {
    throw new Error(`[AUDIT][CONFIG] cannot use recordAuditBestEffort for fail-close action: ${input.action}`);
  }
  try {
    return await recordAuditEvent({ ...input, mode: input.mode || "async" });
  } catch (error) {
    console.error("[AUDIT] best-effort audit event failed", { action: input.action, error });
    return null;
  }
}

export async function recordAuditRequired(input: AuditEventInput): Promise<AuditRecordResult> {
  return await recordAuditEvent({ ...input, mode: "sync" });
}

export function auditErrorMetadata(error: unknown): { error: string; errorName?: string } {
  if (error instanceof Error) return { error: error.message, errorName: error.name };
  return { error: String(error) };
}
