/**
 * 创建邮箱验证码表
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function createVerificationCodesTable() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在创建 email_verification_codes 表...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`email_verification_codes\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`email\` varchar(320) NOT NULL,
        \`code\` varchar(10) NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`used\` enum('yes','no') NOT NULL DEFAULT 'no',
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`email_verification_codes_id\` PRIMARY KEY(\`id\`),
        INDEX \`idx_email\` (\`email\`),
        INDEX \`idx_code\` (\`code\`),
        INDEX \`idx_expiresAt\` (\`expiresAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ email_verification_codes 表创建成功");
    process.exit(0);
  } catch (error) {
    console.error("❌ 创建表失败:", error);
    process.exit(1);
  }
}

createVerificationCodesTable();

