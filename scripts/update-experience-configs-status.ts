/**
 * 更新场景体验配置表：将 enabled 字段改为 status 字段
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function updateExperienceConfigsStatus() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在更新 experience_configs 表结构...");

    // 检查表是否存在
    const [tables] = await db.execute(sql`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'experience_configs'
    `);

    if (!Array.isArray(tables) || tables.length === 0) {
      console.log("⚠️  experience_configs 表不存在，请先运行 create-experience-configs-table.ts");
      process.exit(0);
    }

    // 检查是否已经有 status 字段
    const [columns] = await db.execute(sql`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'experience_configs' 
      AND COLUMN_NAME = 'status'
    `);

    if (Array.isArray(columns) && columns.length > 0) {
      console.log("✅ status 字段已存在，无需更新");
      process.exit(0);
    }

    // 添加 status 字段
    console.log("正在添加 status 字段...");
    await db.execute(sql`
      ALTER TABLE \`experience_configs\` 
      ADD COLUMN \`status\` enum('active','developing') NOT NULL DEFAULT 'active' 
      AFTER \`scenarioId\`
    `);

    // 将 enabled 字段的值迁移到 status 字段
    console.log("正在迁移数据...");
    await db.execute(sql`
      UPDATE \`experience_configs\` 
      SET \`status\` = CASE 
        WHEN \`enabled\` = 'yes' THEN 'active' 
        ELSE 'developing' 
      END
    `);

    // 删除旧的 enabled 字段
    console.log("正在删除旧的 enabled 字段...");
    await db.execute(sql`
      ALTER TABLE \`experience_configs\` 
      DROP COLUMN \`enabled\`
    `);

    console.log("✅ experience_configs 表更新成功");
    process.exit(0);
  } catch (error) {
    console.error("❌ 更新表失败:", error);
    process.exit(1);
  }
}

updateExperienceConfigsStatus();

