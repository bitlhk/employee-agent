/**
 * 统一 API 错误处理
 * 
 * 后端 Express 路由返回 { ok: false, code, message } 格式，
 * 前端用这个 util 统一处理。
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  ok: false;
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** 判断是否为统一格式的 API 错误 */
export function isApiError(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as any).ok === false &&
    typeof (data as any).code === "string"
  );
}

/** 错误码对应的默认中文提示 */
const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  BAD_REQUEST: "请求参数错误",
  UNAUTHORIZED: "请先登录",
  FORBIDDEN: "权限不足",
  NOT_FOUND: "资源不存在",
  CONFLICT: "数据冲突，请刷新后重试",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  PAYLOAD_TOO_LARGE: "内容过大，请缩减后重试",
  INTERNAL_ERROR: "服务异常，请稍后重试",
};

/**
 * 获取用户友好的错误提示
 * 优先使用后端返回的 message，回退到默认中文提示
 */
export function getErrorMessage(error: ApiErrorResponse): string {
  // 如果后端 message 是英文/技术性的，用默认中文
  const msg = error.message;
  if (!msg || /^[a-z_]+$/.test(msg)) {
    return ERROR_MESSAGES[error.code] || "操作失败";
  }
  return msg;
}

/**
 * 判断是否需要跳转登录
 */
export function shouldRedirectToLogin(error: ApiErrorResponse): boolean {
  return error.code === "UNAUTHORIZED";
}

/**
 * 处理 fetch 响应的 helper
 * 用于非 tRPC 的 fetch 调用（如文件下载、sandbox exec 等）
 * 
 * 用法：
 *   const res = await fetch("/api/claw/files/token", { ... });
 *   const data = await res.json();
 *   if (isApiError(data)) {
 *     toast.error(getErrorMessage(data));
 *     if (shouldRedirectToLogin(data)) navigate("/login");
 *     return;
 *   }
 *   // 正常处理 data
 */
