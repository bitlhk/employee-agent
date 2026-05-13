/**
 * 创建 IP 管理表
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

async function createIpManagementTable() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  console.log("🔌 连接到数据库...");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    console.log("📝 检查 ip_management 表是否存在...");

    // 检查表是否存在
    const [tables]: any = await connection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ip_management'
    `);

    if (tables.length === 0) {
      console.log("  - ip_management 表不存在，正在创建...");
      await connection.query(`
        CREATE TABLE \`ip_management\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`ip\` VARCHAR(45) NOT NULL,
          \`type\` ENUM('blacklist', 'whitelist', 'suspicious', 'blocked') NOT NULL,
          \`reason\` VARCHAR(500),
          \`severity\` ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
          \`createdBy\` INT,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`expiresAt\` TIMESTAMP NULL,
          \`isActive\` ENUM('yes', 'no') NOT NULL DEFAULT 'yes',
          \`notes\` TEXT,
          INDEX \`idx_ip\` (\`ip\`),
          INDEX \`idx_type\` (\`type\`),
          INDEX \`idx_isActive\` (\`isActive\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("    ✅ ip_management 表已创建");
    } else {
      console.log("    ⏭️  ip_management 表已存在");
    }

    console.log("\n✨ 迁移完成！");
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ 迁移失败:", error);
    await connection.end();
    process.exit(1);
  }
}

createIpManagementTable();

