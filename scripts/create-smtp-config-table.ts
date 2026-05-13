/**
 * 创建SMTP配置表
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function createSmtpConfigTable() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在创建 smtp_config 表...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`smtp_config\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`host\` varchar(255),
        \`port\` varchar(10),
        \`user\` varchar(320),
        \`password\` varchar(255),
        \`from\` varchar(320),
        \`enabled\` enum('yes','no') NOT NULL DEFAULT 'no',
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        \`updatedBy\` int,
        CONSTRAINT \`smtp_config_id\` PRIMARY KEY(\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ smtp_config 表创建成功");
    process.exit(0);
  } catch (error) {
    console.error("❌ 创建表失败:", error);
    process.exit(1);
  }
}

createSmtpConfigTable();

