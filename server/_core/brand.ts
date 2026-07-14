/**
 * 后端品牌配置加载器
 *
 * 从 system_configs 表读取 brand_* 键，合并默认值后缓存。
 * Admin 修改后调 invalidateBrandCache() 刷新。
 */

import {
  type BrandConfig,
  DEFAULT_BRAND,
  BRAND_DB_KEYS,
  mergeBrandConfig,
} from "@shared/brand";

let _cache: BrandConfig | null = null;

/** 从 DB 加载品牌配置（含缓存） */
export async function getBrandConfig(): Promise<BrandConfig> {
  if (_cache) return _cache;
  try {
    const { getAllSystemConfigs } = await import("../db");
    const rows = await getAllSystemConfigs();
    const map: Record<string, string> = {};
    for (const row of rows) {
      if ((row as any).key?.startsWith("brand_")) {
        map[(row as any).key] = String((row as any).value || "");
      }
    }
    _cache = mergeBrandConfig(map);
  } catch {
    _cache = { ...DEFAULT_BRAND };
  }
  return _cache;
}

/** 清除缓存，下次 getBrandConfig() 会重新从 DB 加载 */
export function invalidateBrandCache(): void {
  _cache = null;
}
