import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { ipAccessLogs, InsertIpAccessLog, IpAccessLog, experienceConfigs } from "../../drizzle/schema";
import { getDb } from "./connection";

// ==================== IP Access Log Functions ====================

/**
 * 记录IP访问日志
 */
export async function createIpAccessLog(data: InsertIpAccessLog): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const result = await db.insert(ipAccessLogs).values(data);
    return result[0].insertId;
  } catch (error) {
    console.error("[Database] Failed to create IP access log:", error);
    throw error;
  }
}

/**
 * 获取指定IP在指定日期内的访问次数
 */
export async function getIpAccessCount(
  ip: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  try {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipAccessLogs)
      .where(
        and(
          eq(ipAccessLogs.ip, ip),
          gte(ipAccessLogs.createdAt, startDate),
          lte(ipAccessLogs.createdAt, endDate)
        )
      );

    return result[0]?.count || 0;
  } catch (error) {
    console.error("[Database] Failed to get IP access count:", error);
    return 0;
  }
}

/**
 * 获取指定IP今天的访问次数
 */
export async function getIpAccessCountToday(ip: string): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return await getIpAccessCount(ip, startOfDay, endOfDay);
}

/**
 * 获取指定IP今天体验按钮点击次数（只统计 experience_click）
 * 使用数据库的日期函数，避免时区问题
 */
export async function getIpAuthAccessCountToday(ip: string): Promise<number> {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  try {
    // 使用数据库的日期函数，避免时区问题
    // 注意：drizzle ORM 需要使用 sql 模板字符串
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipAccessLogs)
      .where(
        and(
          eq(ipAccessLogs.ip, ip),
          sql`DATE(${ipAccessLogs.createdAt}) = CURDATE()`,
          eq(ipAccessLogs.action, "experience_click")
        )
      );

    const count = result[0]?.count || 0;
    console.log(`[DB] getIpAuthAccessCountToday - IP: ${ip}, count: ${count}`);
    return count;
  } catch (error) {
    console.error("[Database] Failed to get IP auth access count:", error);
    // 如果使用 CURDATE() 失败，回退到原来的方法
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(ipAccessLogs)
        .where(
          and(
            eq(ipAccessLogs.ip, ip),
            gte(ipAccessLogs.createdAt, startOfDay),
            lte(ipAccessLogs.createdAt, endOfDay),
            eq(ipAccessLogs.action, "experience_click")
          )
        );

      const count = result[0]?.count || 0;
      console.log(`[DB] getIpAuthAccessCountToday (fallback) - IP: ${ip}, count: ${count}`);
      return count;
    } catch (fallbackError) {
      console.error("[Database] Fallback query also failed:", fallbackError);
      return 0;
    }
  }
}

/**
 * 获取指定IP的访问记录列表（分页）
 * 包含场景和体验名称信息
 */
export async function getIpAccessLogsByIp(
  ip: string,
  page: number = 1,
  pageSize: number = 50
) {
  const db = await getDb();
  if (!db) {
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }

  try {
    const offset = (page - 1) * pageSize;

    // 获取总数
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.ip, ip));

    const total = countResult?.count || 0;

    // 获取分页数据
    const logs = await db
      .select()
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.ip, ip))
      .orderBy(desc(ipAccessLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 从 experienceConfigs 获取 experienceId 到 scenarioId 和 title 的映射
    const configs = await db.select({
      experienceId: experienceConfigs.experienceId,
      scenarioId: experienceConfigs.scenarioId,
      title: experienceConfigs.title,
    }).from(experienceConfigs);

    const expToConfig = new Map<string, { scenarioId: string; title: string }>();
    configs.forEach((config: { experienceId: string; scenarioId: string; title: string }) => {
      expToConfig.set(config.experienceId, { scenarioId: config.scenarioId, title: config.title });
    });

    // 为每条记录添加场景和体验名称信息
    const data = logs.map(log => {
      // 从 path 中提取 experienceId（格式：/api/scenarios/iframe/:experienceId）
      const pathMatch = log.path?.match(/\/api\/scenarios\/iframe\/([^\/\?]+)/);
      const experienceId = pathMatch ? pathMatch[1] : null;

      let scenarioId: string | null = null;
      let experienceTitle: string | null = null;

      if (experienceId) {
        const config = expToConfig.get(experienceId);
        if (config) {
          scenarioId = config.scenarioId;
          experienceTitle = config.title;
        }
      }

      return {
        ...log,
        scenarioId,
        experienceTitle,
      };
    });

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error("[Database] Failed to get IP access logs:", error);
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * 获取所有IP访问记录（管理员用，分页）
 * 包含场景和体验名称信息
 */
export async function getAllIpAccessLogs(
  page: number = 1,
  pageSize: number = 50
) {
  const db = await getDb();
  if (!db) {
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }

  try {
    const offset = (page - 1) * pageSize;

    // 获取总数
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipAccessLogs);

    const total = countResult?.count || 0;

    // 获取分页数据
    const logs = await db
      .select()
      .from(ipAccessLogs)
      .orderBy(desc(ipAccessLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 从 experienceConfigs 获取 experienceId 到 scenarioId 和 title 的映射
    const configs = await db.select({
      experienceId: experienceConfigs.experienceId,
      scenarioId: experienceConfigs.scenarioId,
      title: experienceConfigs.title,
    }).from(experienceConfigs);

    const expToConfig = new Map<string, { scenarioId: string; title: string }>();
    configs.forEach((config: { experienceId: string; scenarioId: string; title: string }) => {
      expToConfig.set(config.experienceId, { scenarioId: config.scenarioId, title: config.title });
    });

    // 为每条记录添加场景和体验名称信息
    const data = logs.map(log => {
      // 从 path 中提取 experienceId（格式：/api/scenarios/iframe/:experienceId）
      const pathMatch = log.path?.match(/\/api\/scenarios\/iframe\/([^\/\?]+)/);
      const experienceId = pathMatch ? pathMatch[1] : null;

      let scenarioId: string | null = null;
      let experienceTitle: string | null = null;

      if (experienceId) {
        const config = expToConfig.get(experienceId);
        if (config) {
          scenarioId = config.scenarioId;
          experienceTitle = config.title;
        }
      }

      return {
        ...log,
        scenarioId,
        experienceTitle,
      };
    });

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error("[Database] Failed to get all IP access logs:", error);
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * 获取IP访问统计（区分已登录和未登录用户）
 */
export async function getIpAccessStatsByUserType() {
  const db = await getDb();
  if (!db) {
    return {
      loggedIn: { total: 0, byAction: {} as Record<string, number> },
      unlogged: { total: 0, byAction: {} as Record<string, number> },
      total: 0,
    };
  }

  try {
    // 获取所有 experience_click 记录
    const logs = await db
      .select()
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.action, "experience_click"))
      .orderBy(desc(ipAccessLogs.createdAt));

    const stats = {
      loggedIn: { total: 0, byAction: {} as Record<string, number> },
      unlogged: { total: 0, byAction: {} as Record<string, number> },
      total: 0,
    };

    logs.forEach((log) => {
      stats.total++;
      if (log.userId) {
        // 已登录用户
        stats.loggedIn.total++;
        stats.loggedIn.byAction[log.action] = (stats.loggedIn.byAction[log.action] || 0) + 1;
      } else {
        // 未登录用户
        stats.unlogged.total++;
        stats.unlogged.byAction[log.action] = (stats.unlogged.byAction[log.action] || 0) + 1;
      }
    });

    return stats;
  } catch (error) {
    console.error("[Database] Failed to get IP access stats:", error);
    return {
      loggedIn: { total: 0, byAction: {} as Record<string, number> },
      unlogged: { total: 0, byAction: {} as Record<string, number> },
      total: 0,
    };
  }
}
