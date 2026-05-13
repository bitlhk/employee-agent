/**
 * 为场景体验配置表添加 inToolbox 字段
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function addInToolboxField() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在为 experience_configs 表添加 inToolbox 字段...");

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

    // 检查 inToolbox 字段是否存在
    const [column] = await db.execute(sql`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'experience_configs' 
      AND COLUMN_NAME = 'inToolbox'
    `);

    if (Array.isArray(column) && column.length > 0) {
      console.log("✅ inToolbox 字段已存在，无需更新");
      process.exit(0);
    }

    // 添加 inToolbox 字段
    console.log("正在添加 inToolbox 字段...");
    await db.execute(sql`
      ALTER TABLE \`experience_configs\` 
      ADD COLUMN \`inToolbox\` enum('yes','no') NOT NULL DEFAULT 'no' 
      AFTER \`displayOrder\`
    `);

    console.log("✅ inToolbox 字段添加成功");
    process.exit(0);
  } catch (error) {
    console.error("❌ 添加字段失败:", error);
    process.exit(1);
  }
}

addInToolboxField();
