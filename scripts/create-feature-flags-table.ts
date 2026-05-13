/**
 * 创建功能开关表并初始化默认功能开关
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { upsertFeatureFlag } from "../server/db";

async function createFeatureFlagsTable() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在创建 feature_flags 表...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`feature_flags\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`key\` varchar(100) NOT NULL,
        \`name\` varchar(200) NOT NULL,
        \`description\` text,
        \`enabled\` enum('yes','no') NOT NULL DEFAULT 'yes',
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        \`updatedBy\` int,
        CONSTRAINT \`feature_flags_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`feature_flags_key_unique\` UNIQUE(\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ feature_flags 表创建成功");

    // 初始化默认功能开关
    console.log("正在初始化默认功能开关...");

    await upsertFeatureFlag({
      key: "scenario_experience",
      name: "场景体验功能",
      description: "控制场景体验功能的开启和关闭。关闭后，用户将无法访问场景体验页面。",
      enabled: "yes",
    });

    console.log("✅ 默认功能开关初始化成功");
    console.log("   - scenario_experience: 场景体验功能（已启用）");

    process.exit(0);
  } catch (error) {
    console.error("❌ 创建表或初始化失败:", error);
    process.exit(1);
  }
}

createFeatureFlagsTable();

