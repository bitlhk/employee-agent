/**
 * 清空数据库并重新创建表结构
 * 警告：这会删除所有数据！
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
import { users, registrations, visitStats } from "../drizzle/schema";

// 加载环境变量
dotenv.config();

async function resetDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  console.log("🔌 连接到数据库...");
  const connection = await mysql.createConnection(databaseUrl);
  const db = drizzle(connection);

  try {
    console.log("🗑️  开始清空数据库...");

    // 删除所有表（按依赖顺序）
    console.log("  - 删除 visit_stats 表...");
    await db.execute(sql`DROP TABLE IF EXISTS visit_stats`);
    
    console.log("  - 删除 registrations 表...");
    await db.execute(sql`DROP TABLE IF EXISTS registrations`);
    
    console.log("  - 删除 users 表...");
    await db.execute(sql`DROP TABLE IF EXISTS users`);

    console.log("✅ 所有表已删除");

    // 关闭连接
    await connection.end();

    console.log("\n📝 请运行以下命令重新创建表结构：");
    console.log("   pnpm run db:push");
    console.log("\n✨ 数据库重置完成！");

  } catch (error) {
    console.error("❌ 重置数据库时出错:", error);
    await connection.end();
    process.exit(1);
  }
}

resetDatabase();

