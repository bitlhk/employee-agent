import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { visitStats, InsertVisitStat, ipAccessLogs, experienceConfigs, users, registrations, visitStatsDaily } from "../../drizzle/schema";
import { getDb } from "./connection";
import { getSystemConfigValue } from "./config";

// ==================== Visit Stats Functions ====================

/**
 * 记录用户点击体验按钮的行为
 */
export async function recordVisit(data: InsertVisitStat): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(visitStats).values(data);
  return result[0].insertId;
}

/**
 * 获取所有访问统计记录（分页）
 */
/**
 * 获取所有访问记录（包括已注册用户和未登录用户，分页）
 * 合并 visitStats（已注册用户）和 ipAccessLogs（所有用户）的数据
 */
export async function getAllVisitStats(
  page: number = 1,
  pageSize: number = 50
) {
  const db = await getDb();
  if (!db) {
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }

  try {
    const offset = (page - 1) * pageSize;

    // 获取已注册用户的访问记录（visitStats）
    const registeredVisits = await db
      .select()
      .from(visitStats)
      .orderBy(desc(visitStats.createdAt));

    // 获取所有 IP 访问日志中的 experience_click（包括已登录和未登录用户）
    const ipLogs = await db
      .select()
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.action, "experience_click"))
      .orderBy(desc(ipAccessLogs.createdAt));

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

    // 转换已注册用户的访问记录
    const registeredVisitList = registeredVisits.map(visit => ({
      id: visit.id,
      registrationId: visit.registrationId,
      userId: visit.registrationId, // 使用 registrationId 作为 userId（已注册用户）
      scenarioId: visit.scenarioId,
      experienceId: visit.experienceId,
      experienceTitle: visit.experienceTitle,
      clickedAt: visit.clickedAt,
      createdAt: visit.createdAt,
      isRegistered: true as const,
    }));

    // 转换 IP 访问日志为访问记录格式
    const ipVisitList = ipLogs
      .map(log => {
        // 从 path 中提取 experienceId
        const pathMatch = log.path?.match(/\/api\/scenarios\/iframe\/([^\/\?]+)/);
        const experienceId = pathMatch ? pathMatch[1] : null;

        if (!experienceId) return null;

        const config = expToConfig.get(experienceId);
        if (!config) return null;

        const isLoggedIn = !!log.userId;
        return {
          id: log.id + 1000000, // 使用大数字避免与 visitStats 的 ID 冲突
          registrationId: log.userId || 0, // 已登录用户使用 userId，未登录为 0（表示未登录）
          userId: log.userId || 0, // 已登录用户使用 userId，未登录为 0（表示未登录）
          scenarioId: config.scenarioId,
          experienceId: experienceId,
          experienceTitle: config.title,
          clickedAt: new Date(log.createdAt).getTime(), // 转换为时间戳
          createdAt: log.createdAt,
          isRegistered: isLoggedIn as true | false, // 有 userId 的是已登录用户
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // 获取用户和注册记录的关联关系（通过邮箱）
    // 用于匹配 visitStats 的 registrationId 和 ipAccessLogs 的 userId
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
    }).from(users);

    const allRegistrations = await db.select({
      id: registrations.id,
      email: registrations.email,
    }).from(registrations);

    // 建立 userId -> registrationId 的映射（通过邮箱）
    const userIdToRegistrationId = new Map<number, number>();
    allUsers.forEach((user: { id: number; email: string | null }) => {
      if (user.email) {
        const registration = allRegistrations.find((r: { id: number; email: string }) => r.email === user.email);
        if (registration) {
          userIdToRegistrationId.set(user.id, registration.id);
        }
      }
    });

    // 合并并去重（如果同一个用户在同一次点击中既在 visitStats 又在 ipAccessLogs 中，只保留 visitStats 的记录）
    type VisitRecord = {
      id: number;
      registrationId: number;
      userId: number;
      scenarioId: string;
      experienceId: string;
      experienceTitle: string;
      clickedAt: number;
      createdAt: Date;
      isRegistered: boolean;
    };
    const allVisitsMap = new Map<number, VisitRecord>();

    // 先添加已注册用户的记录（visitStats）
    registeredVisitList.forEach(visit => {
      allVisitsMap.set(visit.id, visit);
    });

    // 添加 IP 访问日志中的记录（排除已注册用户已存在的记录）
    ipVisitList.forEach(visit => {
      // 对于已登录用户（visit.userId > 0），检查是否已经有对应的 visitStats 记录
      if (visit.userId > 0) {
        // 通过 userId 找到对应的 registrationId
        const correspondingRegistrationId = userIdToRegistrationId.get(visit.userId);

        if (correspondingRegistrationId) {
          // 检查是否已经有相同 registrationId、相同 experienceId、时间相近的记录（来自 visitStats）
          // 扩大时间窗口到 60 秒，因为网络延迟、数据库操作和时区转换可能有时间差
          const existing = Array.from(allVisitsMap.values()).find(
            v => v.registrationId === correspondingRegistrationId &&
                 v.experienceId === visit.experienceId &&
                 Math.abs(v.clickedAt - visit.clickedAt) < 60000 // 60秒内的记录认为是同一次点击
          );

          if (existing) {
            // 已存在 visitStats 记录，跳过 ipAccessLogs 记录（避免重复）
            const timeDiff = Math.abs(existing.clickedAt - visit.clickedAt);
            console.log(`[Visit Stats] Skipped duplicate IP log: userId=${visit.userId}, registrationId=${correspondingRegistrationId}, experienceId=${visit.experienceId}, timeDiff=${timeDiff}ms (${Math.round(timeDiff/1000)}s)`);
            return;
          }
        } else {
          // 已登录用户但没有对应的 registrationId（可能是 OAuth 用户），仍然需要去重
          // 通过 userId + experienceId + 时间窗口来判断
          const existing = Array.from(allVisitsMap.values()).find(
            v => v.userId === visit.userId &&
                 v.userId > 0 &&
                 v.experienceId === visit.experienceId &&
                 Math.abs(v.clickedAt - visit.clickedAt) < 60000 // 60秒内的记录认为是同一次点击
          );

          if (existing) {
            // 已存在记录，跳过（避免重复）
            const timeDiff = Math.abs(existing.clickedAt - visit.clickedAt);
            console.log(`[Visit Stats] Skipped duplicate IP log (no registrationId): userId=${visit.userId}, experienceId=${visit.experienceId}, timeDiff=${timeDiff}ms (${Math.round(timeDiff/1000)}s)`);
            return;
          }
        }
      }

      // 未登录用户或没有对应 visitStats 记录的已登录用户，添加 ipAccessLogs 记录
      allVisitsMap.set(visit.id, visit);
    });

    // 转换为数组并按时间排序
    const allVisits = Array.from(allVisitsMap.values())
      .sort((a, b) => b.clickedAt - a.clickedAt);

    const total = allVisits.length;
    const paginatedData = allVisits.slice(offset, offset + pageSize);

    return {
      data: paginatedData,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error("[Database] Failed to get all visit stats:", error);
    return { data: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * 获取按场景分组的访问统计
 */
export async function getVisitStatsByScenario() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const stats = await db.select().from(visitStats);

  // 按场景分组统计
  const grouped = stats.reduce((acc, stat) => {
    const key = stat.scenarioId;
    if (!acc[key]) {
      acc[key] = { scenarioId: key, count: 0, experiences: {} };
    }
    acc[key].count++;

    const expKey = stat.experienceId;
    if (!acc[key].experiences[expKey]) {
      acc[key].experiences[expKey] = { experienceId: expKey, title: stat.experienceTitle, count: 0 };
    }
    acc[key].experiences[expKey].count++;

    return acc;
  }, {} as Record<string, { scenarioId: string; count: number; experiences: Record<string, { experienceId: string; title: string; count: number }> }>);

  return Object.values(grouped).map(g => ({
    ...g,
    experiences: Object.values(g.experiences)
  }));
}

/**
 * 获取特定注册用户的访问记录
 */
export async function getVisitStatsByRegistrationId(registrationId: number) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return await db.select().from(visitStats).where(eq(visitStats.registrationId, registrationId)).orderBy(desc(visitStats.createdAt));
}

/**
 * 获取按场景分组的访问统计（区分已登录和未登录用户）
 * 结合 visitStats（已注册用户）和 ipAccessLogs（所有用户）的数据
 */
export async function getVisitStatsByScenarioWithUserType() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    // 获取所有场景的访问统计（已注册用户，来自 visitStats）
    const visitStatsData = await getVisitStatsByScenario();

    // 获取所有 IP 访问日志中的 experience_click（包括已登录和未登录用户）
    const ipLogs = await db
      .select()
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.action, "experience_click"))
      .orderBy(desc(ipAccessLogs.createdAt));

    // 从 experienceConfigs 获取 experienceId 到 scenarioId 的映射
    const configs = await db.select({
      experienceId: experienceConfigs.experienceId,
      scenarioId: experienceConfigs.scenarioId,
    }).from(experienceConfigs);

    const expToScenario = new Map<string, string>();
    configs.forEach((config: { experienceId: string; scenarioId: string }) => {
      expToScenario.set(config.experienceId, config.scenarioId);
    });

    // 按场景分组统计 IP 访问日志
    const ipStatsByScenario: Record<string, {
      scenarioId: string;
      loggedIn: number;
      unlogged: number;
      total: number;
      experiences: Record<string, {
        experienceId: string;
        loggedIn: number;
        unlogged: number;
        total: number;
      }>;
    }> = {};

    let skippedNoPath = 0;
    let skippedNoScenario = 0;
    let processedCount = 0;

    ipLogs.forEach((log) => {
      // 从 path 中提取 experienceId（格式：/api/scenarios/iframe/:experienceId）
      const pathMatch = log.path?.match(/\/api\/scenarios\/iframe\/([^\/\?]+)/);
      const experienceId = pathMatch ? pathMatch[1] : null;

      if (!experienceId) {
        skippedNoPath++;
        // 如果是未登录用户且 path 格式不对，可能是旧记录，记录详细信息用于调试
        if (!log.userId) {
          console.log(`[Stats] ⚠️ Skipped unlogged log (no experienceId in path): id=${log.id}, path=${log.path || 'null'}, action=${log.action}, createdAt=${log.createdAt}`);
        }
        return;
      }

      const scenarioId = expToScenario.get(experienceId);
      if (!scenarioId) {
        skippedNoScenario++;
        console.log(`[Stats] Skipped log (no scenarioId): id=${log.id}, experienceId=${experienceId}, userId=${log.userId}`);
        return;
      }

      processedCount++;

      if (!ipStatsByScenario[scenarioId]) {
        ipStatsByScenario[scenarioId] = {
          scenarioId,
          loggedIn: 0,
          unlogged: 0,
          total: 0,
          experiences: {},
        };
      }

      const scenarioStat = ipStatsByScenario[scenarioId];
      scenarioStat.total++;

      if (!scenarioStat.experiences[experienceId]) {
        scenarioStat.experiences[experienceId] = {
          experienceId,
          loggedIn: 0,
          unlogged: 0,
          total: 0,
        };
      }

      const expStat = scenarioStat.experiences[experienceId];
      expStat.total++;

      if (log.userId) {
        scenarioStat.loggedIn++;
        expStat.loggedIn++;
      } else {
        scenarioStat.unlogged++;
        expStat.unlogged++;
      }
    });

    console.log(`[Stats] IP logs processing summary: total=${ipLogs.length}, processed=${processedCount}, skippedNoPath=${skippedNoPath}, skippedNoScenario=${skippedNoScenario}`);
    console.log(`[Stats] IP stats by scenario:`, JSON.stringify(ipStatsByScenario, null, 2));

    // 合并 visitStats 和 ipStats 数据
    // visitStats 中的用户都是已注册用户（已登录），应该计入 loggedIn
    const result = visitStatsData.map(stat => {
      const ipStat = ipStatsByScenario[stat.scenarioId] || {
        scenarioId: stat.scenarioId,
        loggedIn: 0,
        unlogged: 0,
        total: 0,
        experiences: {},
      };

      // 合并体验数据
      const experiences = stat.experiences.map(exp => {
        const ipExpStat = ipStat.experiences[exp.experienceId] || {
          experienceId: exp.experienceId,
          loggedIn: 0,
          unlogged: 0,
          total: 0,
        };

        // visitStats 的 count 应该计入 loggedIn（已注册用户都是已登录的）
        // ipExpStat.loggedIn 是来自 ipAccessLogs 中 userId 不为 null 的记录
        // ipExpStat.unlogged 是来自 ipAccessLogs 中 userId 为 null 的记录
        return {
          ...exp,
          loggedIn: exp.count + ipExpStat.loggedIn, // visitStats 的 count + IP 日志中已登录的
          unlogged: ipExpStat.unlogged, // 只有 IP 日志中未登录的
          total: exp.count + ipExpStat.total, // visitStats 的 count + IP 日志的总数
        };
      });

      // visitStats 的 count 应该计入 loggedIn（已注册用户都是已登录的）
      return {
        ...stat,
        loggedIn: stat.count + ipStat.loggedIn, // visitStats 的 count + IP 日志中已登录的
        unlogged: ipStat.unlogged, // 只有 IP 日志中未登录的
        total: stat.count + ipStat.total, // 合并总数
        experiences,
      };
    });

    // 添加只有 IP 日志但没有 visitStats 的场景
    Object.values(ipStatsByScenario).forEach(ipStat => {
      if (!result.find(r => r.scenarioId === ipStat.scenarioId)) {
        result.push({
          scenarioId: ipStat.scenarioId,
          count: 0, // visitStats 中没有数据
          loggedIn: ipStat.loggedIn,
          unlogged: ipStat.unlogged,
          total: ipStat.total,
          experiences: Object.values(ipStat.experiences).map(exp => ({
            experienceId: exp.experienceId,
            title: "", // 需要从 experienceConfigs 获取
            count: 0,
            loggedIn: exp.loggedIn,
            unlogged: exp.unlogged,
            total: exp.total,
          })),
        });
      }
    });

    return result;
  } catch (error) {
    console.error("[Database] Failed to get visit stats by scenario with user type:", error);
    return [];
  }
}

function parseConfigBool(value: string | null | undefined, defaultValue: boolean = false): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export async function isStatsReadFromAggregateEnabled(): Promise<boolean> {
  const raw = await getSystemConfigValue("stats_read_from_aggregate", "false");
  return parseConfigBool(raw, false);
}

export async function isStatsBackfillJobEnabled(): Promise<boolean> {
  const raw = await getSystemConfigValue("stats_enable_backfill_job", "false");
  return parseConfigBool(raw, false);
}

export async function isStatsReconcileJobEnabled(): Promise<boolean> {
  const raw = await getSystemConfigValue("stats_enable_reconcile_job", "false");
  return parseConfigBool(raw, false);
}

/**
 * 聚合层查询：按场景统计（优先用于后台快速查询）
 */
export async function getVisitStatsByScenarioFromAggregate(options?: {
  startDate?: string;
  endDate?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [] as any[];
  if (options?.startDate) conditions.push(gte(visitStatsDaily.statDate, options.startDate));
  if (options?.endDate) conditions.push(lte(visitStatsDaily.statDate, options.endDate));

  const rows = await db
    .select({
      scenarioId: visitStatsDaily.scenarioId,
      experienceId: visitStatsDaily.experienceId,
      userType: visitStatsDaily.userType,
      pv: sql<number>`SUM(${visitStatsDaily.pv})`,
      uv: sql<number>`SUM(${visitStatsDaily.uv})`,
    })
    .from(visitStatsDaily)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(visitStatsDaily.scenarioId, visitStatsDaily.experienceId, visitStatsDaily.userType);

  const configs = await db.select({
    experienceId: experienceConfigs.experienceId,
    title: experienceConfigs.title,
  }).from(experienceConfigs);

  const expTitleMap = new Map(configs.map(c => [c.experienceId, c.title]));

  const grouped = new Map<string, {
    scenarioId: string;
    count: number;
    totalUv: number;
    loggedIn: number;
    unlogged: number;
    experiences: Map<string, {
      experienceId: string;
      title: string;
      count: number;
      uv: number;
      loggedIn: number;
      unlogged: number;
    }>;
  }>();

  for (const row of rows) {
    const scenario = grouped.get(row.scenarioId) ?? {
      scenarioId: row.scenarioId,
      count: 0,
      totalUv: 0,
      loggedIn: 0,
      unlogged: 0,
      experiences: new Map(),
    };

    const exp = scenario.experiences.get(row.experienceId) ?? {
      experienceId: row.experienceId,
      title: expTitleMap.get(row.experienceId) || row.experienceId,
      count: 0,
      uv: 0,
      loggedIn: 0,
      unlogged: 0,
    };

    exp.count += Number(row.pv || 0);
    exp.uv += Number(row.uv || 0);
    if (row.userType === "registered") {
      exp.loggedIn += Number(row.pv || 0);
      scenario.loggedIn += Number(row.pv || 0);
    } else {
      exp.unlogged += Number(row.pv || 0);
      scenario.unlogged += Number(row.pv || 0);
    }

    scenario.count += Number(row.pv || 0);
    scenario.totalUv += Number(row.uv || 0);
    scenario.experiences.set(row.experienceId, exp);
    grouped.set(row.scenarioId, scenario);
  }

  return Array.from(grouped.values()).map(s => ({
    scenarioId: s.scenarioId,
    count: s.count,
    totalUv: s.totalUv,
    loggedIn: s.loggedIn,
    unlogged: s.unlogged,
    total: s.count,
    experiences: Array.from(s.experiences.values()).sort((a, b) => b.count - a.count),
  }));
}

/**
 * 聚合层查询：首页公开统计（注册数 + 总PV）
 */
export async function getHomepagePublicStatsFromAggregate(): Promise<{ registrations: number; visits: number }> {
  const db = await getDb();
  if (!db) {
    return { registrations: 0, visits: 0 };
  }

  const [regCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(registrations);

  const [visitCountRow] = await db
    .select({ count: sql<number>`SUM(${visitStatsDaily.pv})` })
    .from(visitStatsDaily);

  return {
    registrations: regCountRow?.count || 0,
    visits: Number(visitCountRow?.count || 0),
  };
}

/**
 * 聚合层查询：HOT 榜（最近N天）
 */
export async function getTopHotExperiencesFromAggregate(days: number = 5, limit: number = 3): Promise<Array<{ experienceId: string; count: number }>> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const start = startDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      experienceId: visitStatsDaily.experienceId,
      count: sql<number>`SUM(${visitStatsDaily.pv})`,
    })
    .from(visitStatsDaily)
    .where(gte(visitStatsDaily.statDate, start))
    .groupBy(visitStatsDaily.experienceId)
    .orderBy(sql`SUM(${visitStatsDaily.pv}) DESC`)
    .limit(limit);

  return rows.map(r => ({ experienceId: r.experienceId, count: Number(r.count || 0) }));
}

export async function getTopHotExperiences(days: number = 5, limit: number = 3): Promise<Array<{ experienceId: string; count: number }>> {
  const db = await getDb();
  if (!db) return [];

  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    // 仅基于 IP 点击日志统计（覆盖登录与未登录用户）
    const logs = await db
      .select({ path: ipAccessLogs.path })
      .from(ipAccessLogs)
      .where(
        and(
          eq(ipAccessLogs.action, "experience_click"),
          gte(ipAccessLogs.createdAt, fromDate)
        )
      );

    const counter = new Map<string, number>();
    for (const log of logs) {
      const path = log.path || "";
      const match = path.match(/\/api\/scenarios\/iframe\/([^/?]+)/);
      const experienceId = match?.[1];
      if (!experienceId) continue;
      counter.set(experienceId, (counter.get(experienceId) || 0) + 1);
    }

    return Array.from(counter.entries())
      .map(([experienceId, count]) => ({ experienceId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (error) {
    console.error("[Database] Failed to get top hot experiences:", error);
    return [];
  }
}

/**
 * 首页公开统计：注册用户数 + 总访问量
 * 访问量 = visitStats(已注册用户) + ipAccessLogs 中 experience_click(全量)
 */
export async function getHomepagePublicStats(): Promise<{ registrations: number; visits: number }> {
  const db = await getDb();
  if (!db) {
    return { registrations: 0, visits: 0 };
  }

  try {
    const [regCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(registrations);

    const [visitStatsCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(visitStats);

    const [ipClickCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipAccessLogs)
      .where(eq(ipAccessLogs.action, "experience_click"));

    const registrationsCount = regCountRow?.count || 0;
    const visitsCount = (visitStatsCountRow?.count || 0) + (ipClickCountRow?.count || 0);

    return {
      registrations: registrationsCount,
      visits: visitsCount,
    };
  } catch (error) {
    console.error("[Database] Failed to get homepage public stats:", error);
    return { registrations: 0, visits: 0 };
  }
}
