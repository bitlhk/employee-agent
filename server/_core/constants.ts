/**
 * constants.ts — 全局常量
 * 
 * 集中管理跨模块共享的配置值，避免硬编码散落。
 */

/** 内部 API 鉴权 key（平台内部模块间调用） */
export const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";

if (!process.env.INTERNAL_API_KEY) {
  console.warn("[SECURITY] INTERNAL_API_KEY using default value. Set env var in production!");
}

/** 微信消息最大长度 */
export const MAX_WEIXIN_MSG_LEN = 4000;
