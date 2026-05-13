import mysql from "mysql2/promise";

/**
 * 历史回填脚本（Step2 准备）
 * - 按天分批
 * - 可限速（sleepMs）
 * - 幂等 upsert
 *
 * 用法：
 *   pnpm tsx scripts/visit-stats-backfill.ts 2026-01-01 2026-03-16 150
 */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const start = process.argv[2];
  const end = process.argv[3];
  const sleepMs = Number(process.argv[4] || "120");

  if (!start || !end) {
    throw new Error("Usage: pnpm tsx scripts/visit-stats-backfill.ts <startDate> <endDate> [sleepMs]");
  }

  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 5 });

  try {
    let current = start;
    while (current <= end) {
      const next = addDays(current, 1);
      console.log(`[Backfill] processing ${current}`);

      // registered pv+uv (uv=distinct registrationId)
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
        [current, `${current} 00:00:00`, `${next} 00:00:00`]
      );

      // unlogged pv+uv (uv=distinct ip)
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
        [current, `${current} 00:00:00`, `${next} 00:00:00`]
      );

      current = next;
      if (sleepMs > 0) await sleep(sleepMs);
    }

    console.log("[Backfill] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[Backfill] failed:", err);
  process.exit(1);
});
