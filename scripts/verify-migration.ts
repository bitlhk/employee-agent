import "dotenv/config";
import mysql from "mysql2/promise";

async function verifyMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(databaseUrl);
    
    // 检查表是否存在
    const [tables] = await connection.execute<mysql.RowDataPacket[]>(
      "SHOW TABLES LIKE 'ip_access_logs'"
    );
    
    const [configs] = await connection.execute<mysql.RowDataPacket[]>(
      "SHOW TABLES LIKE 'system_configs'"
    );

    if (tables.length > 0) {
      console.log("✅ ip_access_logs 表已创建");
      
      // 查看表结构
      const [columns] = await connection.execute<mysql.RowDataPacket[]>(
        "DESCRIBE ip_access_logs"
      );
      console.log("\n📋 ip_access_logs 表结构：");
      columns.forEach(col => {
        console.log(`   - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : ''}`);
      });
    } else {
      console.log("❌ ip_access_logs 表未找到");
    }

    if (configs.length > 0) {
      console.log("\n✅ system_configs 表已创建");
      
      // 查看表结构
      const [columns] = await connection.execute<mysql.RowDataPacket[]>(
        "DESCRIBE system_configs"
      );
      console.log("\n📋 system_configs 表结构：");
      columns.forEach(col => {
        console.log(`   - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : ''}`);
      });

      // 检查配置是否已初始化
      const [configRows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT * FROM system_configs WHERE `key` = 'unregistered_daily_limit'"
      );
      
      if (configRows.length > 0) {
        console.log("\n✅ 系统配置已初始化：");
        console.log(`   - ${configRows[0].key}: ${configRows[0].value} (${configRows[0].description})`);
      } else {
        console.log("\n⚠️  系统配置未初始化");
      }
    } else {
      console.log("\n❌ system_configs 表未找到");
    }

    await connection.end();
    console.log("\n✅ 验证完成！");
  } catch (error) {
    console.error("❌ 验证失败:", error);
    process.exit(1);
  }
}

verifyMigration();

