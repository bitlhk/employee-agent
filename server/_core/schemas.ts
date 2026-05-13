/**
 * 统一参数校验 schema
 * 
 * 所有路由共用的参数解析和清洗逻辑。
 * 只负责：类型、格式、基本清洗、基本约束。
 * 不负责：业务权限、文件是否存在、owner 校验。
 */

import { sanitizeRelPath, sanitizeFileName } from "./helpers";

// ── 基础类型 ──

/** 非空字符串，trim 后不为空 */
export function parseNonEmptyString(input: any, fieldName = "field"): string {
  const val = String(input ?? "").trim();
  if (!val) throw new ApiError("BAD_REQUEST", `${fieldName} required`);
  return val;
}

/** 正整数 */
export function parsePositiveInt(input: any, fieldName = "field"): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("BAD_REQUEST", `${fieldName} must be a positive integer`);
  return n;
}

// ── 业务参数 ──

/** adoptId：非空字符串，仅允许 a-z0-9_- */
export function parseAdoptId(input: any): string {
  const val = String(input ?? "").trim();
  if (!val) throw new ApiError("BAD_REQUEST", "adoptId required");
  if (!/^[a-zA-Z0-9_-]+$/.test(val)) throw new ApiError("BAD_REQUEST", "adoptId format invalid");
  return val;
}

/** 相对路径：通过 sanitizeRelPath 清洗 */
export function parseRelPath(input: any, fieldName = "path"): string {
  const raw = String(input ?? "");
  const cleaned = sanitizeRelPath(raw);
  if (!cleaned) throw new ApiError("BAD_REQUEST", `invalid ${fieldName}`);
  return cleaned;
}

/** 文件名：通过 sanitizeFileName 清洗 */
export function parseFileName(input: any, fieldName = "file"): string {
  const raw = String(input ?? "").trim();
  const cleaned = sanitizeFileName(raw);
  if (!cleaned) throw new ApiError("BAD_REQUEST", `invalid ${fieldName}`);
  return cleaned;
}

/** memory target：白名单模式 */
export function parseMemoryTarget(input: any): { target: string; type: "memory" | "dreams" | "daily" | "notes" } {
  const t = String(input ?? "").trim();
  if (!t) throw new ApiError("BAD_REQUEST", "target required");

  if (t === "MEMORY.md") return { target: t, type: "memory" };
  if (t === "DREAMS.md") return { target: t, type: "dreams" };

  const m = t.match(/^memory:(\d{4}-\d{2}-\d{2})$/);
  if (m) return { target: t, type: "daily" };

  const n = t.match(/^notes:([a-zA-Z0-9._-]+\.md)$/);
  if (n) return { target: t, type: "notes" };

  throw new ApiError("BAD_REQUEST", "path_not_allowed");
}

/** TTL 秒数：正整数，默认值可选 */
export function parseTtl(input: any, defaultValue = 1800): number {
  if (input === undefined || input === null) return defaultValue;
  const n = Number(input);
  return Number.isInteger(n) && n > 0 ? n : defaultValue;
}

/** memory write mode: append | replace */
export function parseWriteMode(input: any): "append" | "replace" {
  const mode = String(input ?? "append").trim();
  if (mode !== "append" && mode !== "replace") throw new ApiError("BAD_REQUEST", "invalid_mode");
  return mode;
}

// ── 统一错误语义 ──

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

const CODE_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  public code: ApiErrorCode;
  public status: number;
  public details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = CODE_STATUS[code];
    this.details = details;
  }
}

// 向后兼容：SchemaError 是 ApiError 的别名
export const SchemaError = ApiError;

// ── 统一错误响应 ──

export function sendError(res: any, code: ApiErrorCode, message: string, details?: Record<string, unknown>): any {
  return res.status(CODE_STATUS[code]).json({
    ok: false,
    code,
    message,
    ...(details ? { details } : {}),
  });
}

/**
 * Express 路由中统一捕获错误的辅助函数
 * 自动识别 ApiError / SchemaError，其他错误返回 500
 */
export function handleSchemaError(res: any, e: unknown): any {
  if (e instanceof ApiError) {
    return sendError(res, e.code, e.message, e.details);
  }
  // 非 ApiError 继续抛出（让外层 catch 处理）
  throw e;
}

/**
 * 完整的 catch handler：ApiError 走统一格式，其他走 500
 */
export function handleRouteError(res: any, e: unknown): any {
  if (e instanceof ApiError) {
    return sendError(res, e.code, e.message, e.details);
  }
  return sendError(res, "INTERNAL_ERROR", String((e as any)?.message || e));
}
