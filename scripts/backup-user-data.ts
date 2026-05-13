/**
 * 将数据库中的用户相关数据导出到本地 JSON 备份
 * 备份表：users, registrations, visit_stats
 */

import "dotenv/config";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getDb } from "../server/db";
import { users, registrations, visitStats } from "../drizzle/schema";

const BACKUP_DIR = path.resolve(process.cwd(), "backups");

async function backupUserData() {
  const db = await getDb();
  if (!db) {
    console.error("[Backup] 无法连接数据库，请检查 .env 中的 DATABASE_URL");
    process.exit(1);
  }

  try {
    await mkdir(BACKUP_DIR, { recursive: true });

    const [usersData, registrationsData, visitStatsData] = await Promise.all([
      db.select().from(users),
      db.select().from(registrations),
      db.select().from(visitStats),
    ]);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backup = {
      exportedAt: new Date().toISOString(),
      tables: {
        users: usersData,
        registrations: registrationsData,
        visit_stats: visitStatsData,
      },
      counts: {
        users: usersData.length,
        registrations: registrationsData.length,
        visit_stats: visitStatsData.length,
      },
    };

    const filename = `user-data-${timestamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    await writeFile(filepath, JSON.stringify(backup, null, 2), "utf-8");

    console.log("[Backup] 用户数据已备份到:", filepath);
    console.log("[Backup] 统计: users=%d, registrations=%d, visit_stats=%d", backup.counts.users, backup.counts.registrations, backup.counts.visit_stats);
  } catch (err) {
    console.error("[Backup] 备份失败:", err);
    process.exit(1);
  }

  process.exit(0);
}

backupUserData();
