import { desc, eq, and } from "drizzle-orm";
import { featureFlags, InsertFeatureFlag, FeatureFlag, experienceConfigs, InsertExperienceConfig, ExperienceConfig, dailyInsights, DailyInsight, InsertDailyInsight, systemConfigs, InsertSystemConfig, SystemConfig } from "../../drizzle/schema";
import { getDb } from "./connection";

/**
 * 获取所有功能开关
 */
export async function getAllFeatureFlags(): Promise<FeatureFlag[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return await db.select().from(featureFlags).orderBy(featureFlags.key);
}

/**
 * 根据键名获取功能开关
 */
export async function getFeatureFlag(key: string): Promise<FeatureFlag | null> {
  const db = await getDb();
  if (!db) {
    return null;
  }

  const flags = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);

  return flags.length > 0 ? flags[0] : null;
}

/**
 * 检查功能是否启用
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flag = await getFeatureFlag(key);
  return flag?.enabled === "yes";
}

/**
 * 更新或创建功能开关
 */
export async function upsertFeatureFlag(
  flag: Omit<InsertFeatureFlag, "id" | "updatedAt">,
  updatedBy?: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const existing = await getFeatureFlag(flag.key);

  if (existing) {
    // 更新现有开关
    await db
      .update(featureFlags)
      .set({
        name: flag.name,
        description: flag.description,
        enabled: flag.enabled,
        updatedBy: updatedBy || null,
      })
      .where(eq(featureFlags.id, existing.id));
  } else {
    // 创建新开关
    await db.insert(featureFlags).values({
      ...flag,
      updatedBy: updatedBy || null,
    });
  }
}

/**
 * 获取所有场景体验配置
 */
export async function getAllExperienceConfigs(accessLevel?: "public_only" | "all"): Promise<ExperienceConfig[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  if (accessLevel === "public_only") {
    return await db
      .select()
      .from(experienceConfigs)
      .where(eq(experienceConfigs.visibility, "public"))
      .orderBy(experienceConfigs.displayOrder, experienceConfigs.id);
  }

  return await db
    .select()
    .from(experienceConfigs)
    .orderBy(experienceConfigs.displayOrder, experienceConfigs.id);
}

/**
 * 根据体验ID获取配置
 */
export async function getExperienceConfig(experienceId: string): Promise<ExperienceConfig | null> {
  const db = await getDb();
  if (!db) {
    return null;
  }

  const configs = await db
    .select()
    .from(experienceConfigs)
    .where(eq(experienceConfigs.experienceId, experienceId))
    .limit(1);

  return configs.length > 0 ? configs[0] : null;
}

/**
 * 根据场景ID获取配置列表
 */
export async function getExperienceConfigsByScenario(scenarioId: string): Promise<ExperienceConfig[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return await db
    .select()
    .from(experienceConfigs)
    .where(
      and(
        eq(experienceConfigs.scenarioId, scenarioId),
        eq(experienceConfigs.status, "active")
      )
    )
    .orderBy(experienceConfigs.displayOrder, experienceConfigs.id);
}

/**
 * 创建场景体验配置
 */
export async function createExperienceConfig(
  config: Omit<InsertExperienceConfig, "id" | "createdAt" | "updatedAt">,
  updatedBy?: number
): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(experienceConfigs).values({
    ...config,
    updatedBy: updatedBy || null,
  });

  return result[0].insertId;
}

/**
 * 更新场景体验配置
 */
export async function updateExperienceConfig(
  id: number,
  config: Partial<Omit<InsertExperienceConfig, "id" | "createdAt" | "updatedAt" | "experienceId">>,
  updatedBy?: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(experienceConfigs)
    .set({
      ...config,
      updatedBy: updatedBy || null,
    })
    .where(eq(experienceConfigs.id, id));
}

/**
 * 删除场景体验配置
 */
export async function deleteExperienceConfig(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(experienceConfigs).where(eq(experienceConfigs.id, id));
}

/**
 * 获取启用的体验配置映射表（用于快速查找URL）
 */
export async function getExperienceUrlMap(): Promise<Record<string, string>> {
  const configs = await getAllExperienceConfigs();
  const map: Record<string, string> = {};

  for (const config of configs) {
    if (config.status === "active") {
      map[config.experienceId] = config.url;
    }
  }

  return map;
}

/**
 * 每日洞察相关操作
 */
export async function getLatestDailyInsight(): Promise<DailyInsight | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(dailyInsights)
      .orderBy(desc(dailyInsights.date), desc(dailyInsights.updatedAt))
      .limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error("[Database] Failed to get latest daily insight:", error);
    return null;
  }
}

export async function upsertDailyInsight(input: {
  date: string;
  title: string;
  summary?: string | null;
  content: string;
  source?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const values: InsertDailyInsight = {
    date: input.date,
    title: input.title,
    summary: input.summary ?? null,
    content: input.content,
    source: input.source ?? "openclaw",
  };

  try {
    await db.insert(dailyInsights).values(values).onDuplicateKeyUpdate({
      set: {
        title: values.title,
        summary: values.summary,
        content: values.content,
        source: values.source,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[Database] Failed to upsert daily insight:", error);
    throw error;
  }
}

/**
 * 获取系统配置
 */
export async function getSystemConfig(key: string): Promise<SystemConfig | null> {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const configs = await db
      .select()
      .from(systemConfigs)
      .where(eq(systemConfigs.key, key))
      .limit(1);

    return configs.length > 0 ? configs[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get system config:", error);
    return null;
  }
}

/**
 * 获取系统配置值（字符串）
 */
export async function getSystemConfigValue(key: string, defaultValue: string = ""): Promise<string> {
  const config = await getSystemConfig(key);
  return config?.value || defaultValue;
}

/**
 * 获取系统配置值（数字）
 */
export async function getSystemConfigNumber(key: string, defaultValue: number = 0): Promise<number> {
  const config = await getSystemConfig(key);
  if (!config) {
    return defaultValue;
  }

  try {
    const value = JSON.parse(config.value);
    return typeof value === "number" ? value : defaultValue;
  } catch {
    // 如果不是JSON，尝试直接解析为数字
    const num = Number(config.value);
    return isNaN(num) ? defaultValue : num;
  }
}

/**
 * 更新或创建系统配置
 */
export async function upsertSystemConfig(
  config: Omit<InsertSystemConfig, "id" | "updatedAt">,
  updatedBy?: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const existing = await getSystemConfig(config.key);

    if (existing) {
      // 更新现有配置
      await db
        .update(systemConfigs)
        .set({
          value: config.value,
          description: config.description || null,
          updatedBy: updatedBy || null,
        })
        .where(eq(systemConfigs.id, existing.id));
    } else {
      // 创建新配置
      await db.insert(systemConfigs).values({
        ...config,
        updatedBy: updatedBy || null,
      });
    }
  } catch (error) {
    console.error("[Database] Failed to upsert system config:", error);
    throw error;
  }
}

/**
 * 获取所有系统配置
 */
export async function getAllSystemConfigs(): Promise<SystemConfig[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db.select().from(systemConfigs).orderBy(systemConfigs.key);
  } catch (error) {
    console.error("[Database] Failed to get all system configs:", error);
    return [];
  }
}
