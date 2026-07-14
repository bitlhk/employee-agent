/**
 * 确保 ip_management.type 的 ENUM 包含 'blocked'
 * 若表由旧版本创建且缺少该值，INSERT type='blocked' 会失败或落为它值，导致「封禁IP」在 IP 管理里看不到
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

async function addBlockedToIpManagementEnum() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  console.log("🔌 连接到数据库...");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    const [cols]: any = await connection.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ip_management'
        AND COLUMN_NAME = 'type'
    `);

    if (cols.length === 0) {
      console.log("  ⏭️  ip_management 表或 type 列不存在，跳过");
      await connection.end();
      process.exit(0);
      return;
    }

    const enumDef = (cols[0].COLUMN_TYPE || "").toLowerCase();
    if (enumDef.includes("'blocked'")) {
      console.log("  ✅ type 已包含 'blocked'，无需修改");
      await connection.end();
      process.exit(0);
      return;
    }

    console.log("  📝 正在将 'blocked' 加入 type 的 ENUM...");
    await connection.query(`
      ALTER TABLE \`ip_management\`
      MODIFY COLUMN \`type\` ENUM('blacklist','whitelist','suspicious','blocked') NOT NULL
    `);
    console.log("  ✅ 已更新 ip_management.type，现包含: blacklist, whitelist, suspicious, blocked");
  } catch (e) {
    console.error("❌ 迁移失败:", e);
    await connection.end();
    process.exit(1);
  }

  await connection.end();
  process.exit(0);
}

addBlockedToIpManagementEnum();
