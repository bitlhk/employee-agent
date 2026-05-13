import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  try {
    // 创建数据库连接
    const connection = await mysql.createConnection(databaseUrl);
    console.log("✅ 数据库连接成功");

    // 读取迁移SQL文件
    const migrationPath = join(__dirname, "../drizzle/0004_add_ip_access_logs_and_system_configs.sql");
    const sql = readFileSync(migrationPath, "utf-8");
    
    // 分割SQL语句（按 --> statement-breakpoint 分割）
    const statements = sql
      .split(/--> statement-breakpoint/)
      .map(s => s.trim())
      .filter(s => {
        // 过滤掉空字符串和纯注释行
        const lines = s.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        });
        return lines.length > 0;
      });

    console.log(`📝 准备执行 ${statements.length} 条SQL语句...`);

    // 执行每条SQL语句
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`\n[${i + 1}/${statements.length}] 执行SQL语句...`);
          await connection.execute(statement);
          console.log(`✅ SQL语句执行成功`);
        } catch (error: any) {
          // 如果表已存在，跳过
          if (error.code === "ER_TABLE_EXISTS_ERROR" || error.code === "ER_DUP_ENTRY") {
            console.log(`⚠️  表或数据已存在，跳过: ${error.message}`);
          } else {
            throw error;
          }
        }
      }
    }

    await connection.end();
    console.log("\n✅ 数据库迁移完成！");
    console.log("\n📊 已创建的表：");
    console.log("   - ip_access_logs (IP访问统计表)");
    console.log("   - system_configs (系统配置表)");
    console.log("\n⚙️  已初始化的配置：");
    console.log("   - unregistered_daily_limit: 10 (未注册用户每日访问限制)");
  } catch (error) {
    console.error("❌ 迁移失败:", error);
    process.exit(1);
  }
}

applyMigration();

