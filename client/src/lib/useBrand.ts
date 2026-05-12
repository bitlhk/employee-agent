/**
 * 前端品牌配置 hook
 *
 * 从 /api/brand 加载品牌配置，全局缓存。
 * 未加载完成前返回默认品牌值，保证零闪烁。
 */

import { useEffect, useState } from "react";
import { type BrandConfig, DEFAULT_BRAND } from "@shared/brand";

let _cache: BrandConfig | null = null;
let _promise: Promise<BrandConfig> | null = null;

function fetchBrand(): Promise<BrandConfig> {
  if (_promise) return _promise;
  _promise = fetch("/api/brand")
    .then((r) => (r.ok ? r.json() : DEFAULT_BRAND))
    .then((data: BrandConfig) => {
      _cache = data;
      return data;
    })
    .catch(() => {
      _cache = DEFAULT_BRAND;
      return DEFAULT_BRAND;
    });
  return _promise;
}

/** 将品牌 accentColor 注入到 CSS 变量，实现企业定制 */
function injectBrandTokens(brand: BrandConfig) {
  const root = document.documentElement;
  if (brand.accentColor && brand.accentColor !== DEFAULT_BRAND.accentColor) {
    // 品牌色覆盖（企业定制时生效）
    root.style.setProperty("--oc-accent", brand.accentColor);
    root.style.setProperty("--accent", brand.accentColor);
    // 自动派生 hover / subtle / glow
    root.style.setProperty("--oc-accent-hover", brand.accentColor + "cc");
    root.style.setProperty("--oc-accent-subtle", brand.accentColor + "1a");
    root.style.setProperty("--oc-accent-glow", brand.accentColor + "33");
  }
}

export function useBrand(): BrandConfig {
  const [brand, setBrand] = useState<BrandConfig>(_cache || DEFAULT_BRAND);

  useEffect(() => {
    if (_cache) {
      setBrand(_cache);
      injectBrandTokens(_cache);
      return;
    }
    fetchBrand().then((b) => {
      setBrand(b);
      injectBrandTokens(b);
    });
  }, []);

  return brand;
}

/** 命令式获取（非 React 场景） */
export async function getBrand(): Promise<BrandConfig> {
  if (_cache) return _cache;
  return fetchBrand();
}

/** 强制刷新缓存（Admin 保存后调用） */
export function invalidateBrandClientCache(): void {
  _cache = null;
  _promise = null;
}
