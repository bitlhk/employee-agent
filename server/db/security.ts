import { desc, eq, inArray, and, sql } from "drizzle-orm";
import { securityLogs, ipManagement, InsertSecurityLog, InsertIpManagement } from "../../drizzle/schema";
import { getDb } from "./connection";

// ==================== Security Log Functions ====================

/**
 * 记录安全日志
 */
export async function createSecurityLog(data: InsertSecurityLog): Promise<number> {
  const db = await getDb();
  if (!db) {
    // 如果数据库不可用，只记录到控制台
    console.warn("[Security] Database not available, logging to console only:", data);
    return 0;
  }

  try {
    const result = await db.insert(securityLogs).values(data);
    return result[0].insertId;
  } catch (error) {
    // 如果写入失败，记录到控制台但不抛出错误
    console.error("[Security] Failed to write security log to database:", error);
    console.warn("[Security] Log data:", data);
    return 0;
  }
}

/**
 * 获取所有安全日志（管理员用，分页）
 */
export async function getAllSecurityLogs(
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
      .from(securityLogs);

    const total = countResult?.count || 0;

    // 获取分页数据
    const data = await db
      .select()
      .from(securityLogs)
      .orderBy(desc(securityLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error("[Database] Failed to get all security logs:", error);
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * 根据 IP 地址获取安全日志（分页）
 */
export async function getSecurityLogsByIp(
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
      .from(securityLogs)
      .where(eq(securityLogs.ip, ip));

    const total = countResult?.count || 0;

    // 获取分页数据
    const data = await db
      .select()
      .from(securityLogs)
      .where(eq(securityLogs.ip, ip))
      .orderBy(desc(securityLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (error) {
    console.error("[DB] Failed to get security logs by IP:", error);
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * 根据严重程度获取安全日志
 */
export async function getSecurityLogsBySeverity(
  severity: "low" | "medium" | "high" | "critical",
  limit: number = 100
) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return await db
    .select()
    .from(securityLogs)
    .where(eq(securityLogs.severity, severity))
    .orderBy(desc(securityLogs.createdAt))
    .limit(limit);
}

/**
 * 根据 ID 获取单条安全日志
 */
export async function getSecurityLogById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(securityLogs).where(eq(securityLogs.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 根据 ID 列表批量获取安全日志
 */
export async function getSecurityLogsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return await db.select().from(securityLogs).where(inArray(securityLogs.id, ids));
}

// ==================== IP Management Functions ====================

/**
 * 创建IP管理记录
 */
export async function createIpManagement(data: InsertIpManagement): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(ipManagement).values(data);
  return result[0].insertId;
}

/**
 * 获取所有IP管理记录
 */
export async function getAllIpManagement() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db
      .select()
      .from(ipManagement)
      .orderBy(desc(ipManagement.createdAt));
  } catch (error) {
    console.error("[Database] Failed to get IP management:", error);
    // 如果表不存在，返回空数组
    if (error instanceof Error && error.message.includes("doesn't exist")) {
      return [];
    }
    throw error;
  }
}

/**
 * 根据IP地址获取管理记录
 */
export async function getIpManagementByIp(ip: string) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db
      .select()
      .from(ipManagement)
      .where(eq(ipManagement.ip, ip))
      .orderBy(desc(ipManagement.createdAt));
  } catch (error) {
    console.error("[Database] Failed to get IP management by IP:", error);
    // 如果表不存在，返回空数组
    if (error instanceof Error && error.message.includes("doesn't exist")) {
      return [];
    }
    throw error;
  }
}

/**
 * 根据类型获取IP管理记录
 */
export async function getIpManagementByType(
  type: "blacklist" | "whitelist" | "suspicious" | "blocked"
) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db
      .select()
      .from(ipManagement)
      .where(
        and(
          eq(ipManagement.type, type),
          eq(ipManagement.isActive, "yes")
        )
      )
      .orderBy(desc(ipManagement.createdAt));
  } catch (error) {
    console.error("[Database] Failed to get IP management by type:", error);
    // 如果表不存在，返回空数组
    if (error instanceof Error && error.message.includes("doesn't exist")) {
      return [];
    }
    throw error;
  }
}

/**
 * 检查IP是否在黑名单中
 */
export async function isIpBlacklisted(ip: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return false;
  }

  try {
    const now = new Date();
    const result = await db
      .select()
      .from(ipManagement)
      .where(
        and(
          eq(ipManagement.ip, ip),
          eq(ipManagement.type, "blacklist"),
          eq(ipManagement.isActive, "yes")
        )
      )
      .limit(1);

    // 检查是否过期
    if (result.length > 0) {
      const record = result[0];
      if (record.expiresAt) {
        const expiresAt = new Date(record.expiresAt);
        if (expiresAt <= now) {
          // 已过期，自动禁用
          try {
            await db
              .update(ipManagement)
              .set({ isActive: "no" })
              .where(eq(ipManagement.id, record.id));
          } catch (error) {
            console.error("[Database] Failed to disable expired IP:", error);
          }
          return false;
        }
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error("[Database] Failed to check IP blacklist:", error);
    // 如果表不存在或查询失败，返回 false（不阻止请求）
    if (error instanceof Error && error.message.includes("doesn't exist")) {
      return false;
    }
    // 其他错误也返回 false，避免阻塞正常请求
    return false;
  }
}

/**
 * 检查IP是否在白名单中
 */
export async function isIpWhitelisted(ip: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return false;
  }

  try {
    const result = await db
      .select()
      .from(ipManagement)
      .where(
        and(
          eq(ipManagement.ip, ip),
          eq(ipManagement.type, "whitelist"),
          eq(ipManagement.isActive, "yes")
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (error) {
    console.error("[Database] Failed to check IP whitelist:", error);
    // 如果表不存在或查询失败，返回 false
    if (error instanceof Error && error.message.includes("doesn't exist")) {
      return false;
    }
    return false;
  }
}

/**
 * 更新IP管理记录
 */
export async function updateIpManagement(
  id: number,
  updates: Partial<InsertIpManagement>
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(ipManagement)
    .set(updates)
    .where(eq(ipManagement.id, id));
}

/**
 * 删除IP管理记录（软删除）
 */
export async function deleteIpManagement(id: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(ipManagement)
    .set({ isActive: "no" })
    .where(eq(ipManagement.id, id));
}

/**
 * 恢复IP管理记录
 */
export async function restoreIpManagement(id: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(ipManagement)
    .set({ isActive: "yes" })
    .where(eq(ipManagement.id, id));
}

/**
 * 更新安全日志状态
 */
export async function updateSecurityLogStatus(
  id: number,
  status: "pending" | "resolved" | "ignored" | "blocked",
  handledBy?: number,
  handledNote?: string
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(securityLogs)
    .set({
      status,
      handledBy: handledBy || null,
      handledAt: status !== "pending" ? new Date() : null,
      handledNote: handledNote || null,
    })
    .where(eq(securityLogs.id, id));
}

/**
 * 批量更新安全日志状态
 */
export async function batchUpdateSecurityLogStatus(
  ids: number[],
  status: "pending" | "resolved" | "ignored" | "blocked",
  handledBy?: number,
  handledNote?: string
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  if (ids.length === 0) {
    return;
  }

  // 使用 IN 查询批量更新
  await db
    .update(securityLogs)
    .set({
      status,
      handledBy: handledBy || null,
      handledAt: status !== "pending" ? new Date() : null,
      handledNote: handledNote || null,
    })
    .where(inArray(securityLogs.id, ids));
}
