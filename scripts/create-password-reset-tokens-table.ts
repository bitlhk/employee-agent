/**
 * 创建密码重置token表
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function createPasswordResetTokensTable() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在创建 password_reset_tokens 表...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`password_reset_tokens\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`email\` varchar(320) NOT NULL,
        \`token\` varchar(64) NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`used\` enum('yes','no') NOT NULL DEFAULT 'no',
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`password_reset_tokens_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`password_reset_tokens_token_unique\` UNIQUE(\`token\`),
        INDEX \`idx_email\` (\`email\`),
        INDEX \`idx_token\` (\`token\`),
        INDEX \`idx_expiresAt\` (\`expiresAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ password_reset_tokens 表创建成功");
    process.exit(0);
  } catch (error) {
    console.error("❌ 创建表失败:", error);
    process.exit(1);
  }
}

createPasswordResetTokensTable();

