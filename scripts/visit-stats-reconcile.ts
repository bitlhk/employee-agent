import mysql from "mysql2/promise";

/**
 * 夜间校准脚本（Step2 准备）
 * 默认重算昨天，可选滑窗天数
 *
 * 用法：
 *   pnpm tsx scripts/visit-stats-reconcile.ts
 *   pnpm tsx scripts/visit-stats-reconcile.ts 3   # 重算最近3天（含昨天）
 */

function toDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

async function reconcileDay(pool: mysql.Pool, day: string) {
  const next = addDays(day, 1);

  await pool.query(
    `
INSERT INTO visit_stats_daily (statDate, scenarioId, experienceId, userType, pv, uv)
SELECT ?, scenarioId, experienceId, 'registered' as userType, COUNT(*) as pv, COUNT(DISTINCT registrationId) as uv
FROM visit_stats
WHERE createdAt >= ? AND createdAt < ?
GROUP BY scenarioId, experienceId
ON DUPLICATE KEY UPDATE
  pv = VALUES(pv),
  uv = VALUES(uv),
  updatedAt = CURRENT_TIMESTAMP
`,
    [day, `${day} 00:00:00`, `${next} 00:00:00`]
  );

  await pool.query(
    `
INSERT INTO visit_stats_daily (statDate, scenarioId, experienceId, userType, pv, uv)
SELECT
  ?,
  COALESCE(em.scenarioId, 'unknown') as scenarioId,
  p.experienceId,
  'unlogged' as userType,
  COUNT(*) as pv,
  COUNT(DISTINCT ial.ip) as uv
FROM ip_access_logs ial
JOIN (
  SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(path, CHAR(63), 1), '/api/scenarios/iframe/', -1) AS experienceId, id, ip, createdAt, action, userId, path
  FROM ip_access_logs
) p ON p.id = ial.id
LEFT JOIN (
  SELECT experienceId, ANY_VALUE(scenarioId) AS scenarioId
  FROM (
    SELECT experienceId, scenarioId FROM experience_configs
    UNION ALL
    SELECT experienceId, scenarioId FROM visit_stats
  ) x
  GROUP BY experienceId
) em ON em.experienceId = p.experienceId
WHERE ial.action = 'experience_click'
  AND ial.userId IS NULL
  AND ial.path LIKE '/api/scenarios/iframe/%'
  AND ial.createdAt >= ?
  AND ial.createdAt < ?
GROUP BY COALESCE(em.scenarioId, 'unknown'), p.experienceId
ON DUPLICATE KEY UPDATE
  pv = VALUES(pv),
  uv = VALUES(uv),
  updatedAt = CURRENT_TIMESTAMP
`,
    [day, `${day} 00:00:00`, `${next} 00:00:00`]
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const windowDays = Math.max(1, Number(process.argv[2] || "1"));
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 3 });

  try {
    const today = new Date();
    const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

    for (let i = 0; i < windowDays; i++) {
      const d = new Date(yesterday);
      d.setUTCDate(d.getUTCDate() - i);
      const day = toDateOnly(d);
      console.log(`[Reconcile] ${day}`);
      await reconcileDay(pool, day);
    }

    console.log("[Reconcile] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[Reconcile] failed:", err);
  process.exit(1);
});
