/**
 * 为 security_logs 表添加处理状态相关字段
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

async function addSecurityLogFields() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  console.log("🔌 连接到数据库...");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    console.log("📝 检查 security_logs 表是否存在...");

    // 检查表是否存在
    const [tables]: any = await connection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'security_logs'
    `);

    if (tables.length === 0) {
      console.log("  - security_logs 表不存在，正在创建...");
      await connection.query(`
        CREATE TABLE \`security_logs\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`ip\` VARCHAR(45) NOT NULL,
          \`path\` VARCHAR(500) NOT NULL,
          \`method\` VARCHAR(10) NOT NULL,
          \`userAgent\` TEXT,
          \`reason\` VARCHAR(200) NOT NULL,
          \`details\` TEXT,
          \`severity\` ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
          \`status\` ENUM('pending', 'resolved', 'ignored', 'blocked') NOT NULL DEFAULT 'pending',
          \`handledBy\` INT NULL,
          \`handledAt\` TIMESTAMP NULL,
          \`handledNote\` TEXT NULL,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("    ✅ security_logs 表已创建");
      console.log("\n✨ 迁移完成！");
      await connection.end();
      process.exit(0);
      return;
    }

    console.log("📝 检查字段是否存在...");

    // 检查字段是否存在
    const [columns]: any = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'security_logs'
      AND COLUMN_NAME IN ('status', 'handledBy', 'handledAt', 'handledNote')
    `);

    const existingColumns = columns.map((col: any) => col.COLUMN_NAME);

    // 添加 status 字段
    if (!existingColumns.includes('status')) {
      console.log("  - 添加 status 字段...");
      await connection.query(`
        ALTER TABLE \`security_logs\` 
        ADD COLUMN \`status\` ENUM('pending', 'resolved', 'ignored', 'blocked') NOT NULL DEFAULT 'pending' AFTER \`severity\`
      `);
      console.log("    ✅ status 字段已添加");
    } else {
      console.log("    ⏭️  status 字段已存在");
    }

    // 添加 handledBy 字段
    if (!existingColumns.includes('handledBy')) {
      console.log("  - 添加 handledBy 字段...");
      await connection.query(`
        ALTER TABLE \`security_logs\` 
        ADD COLUMN \`handledBy\` INT NULL AFTER \`status\`
      `);
      console.log("    ✅ handledBy 字段已添加");
    } else {
      console.log("    ⏭️  handledBy 字段已存在");
    }

    // 添加 handledAt 字段
    if (!existingColumns.includes('handledAt')) {
      console.log("  - 添加 handledAt 字段...");
      await connection.query(`
        ALTER TABLE \`security_logs\` 
        ADD COLUMN \`handledAt\` TIMESTAMP NULL AFTER \`handledBy\`
      `);
      console.log("    ✅ handledAt 字段已添加");
    } else {
      console.log("    ⏭️  handledAt 字段已存在");
    }

    // 添加 handledNote 字段
    if (!existingColumns.includes('handledNote')) {
      console.log("  - 添加 handledNote 字段...");
      await connection.query(`
        ALTER TABLE \`security_logs\` 
        ADD COLUMN \`handledNote\` TEXT NULL AFTER \`handledAt\`
      `);
      console.log("    ✅ handledNote 字段已添加");
    } else {
      console.log("    ⏭️  handledNote 字段已存在");
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

addSecurityLogFields();

