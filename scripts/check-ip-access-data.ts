import "dotenv/config";
import mysql from "mysql2/promise";

async function checkData() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(databaseUrl);
    
    console.log("📊 查询数据库记录...\n");
    
    // 查询系统配置
    console.log("=".repeat(60));
    console.log("系统配置 (system_configs):");
    console.log("=".repeat(60));
    const [configs] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM system_configs ORDER BY id"
    );
    if (configs.length > 0) {
      configs.forEach(config => {
        console.log(`  ID: ${config.id}`);
        console.log(`  键名: ${config.key}`);
        console.log(`  值: ${config.value}`);
        console.log(`  描述: ${config.description || '无'}`);
        console.log(`  更新时间: ${config.updatedAt}`);
        console.log("");
      });
    } else {
      console.log("  无记录\n");
    }
    
    // 查询IP访问日志总数
    console.log("=".repeat(60));
    console.log("IP访问日志统计 (ip_access_logs):");
    console.log("=".repeat(60));
    const [totalCount] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM ip_access_logs"
    );
    console.log(`  总记录数: ${totalCount[0].total}`);
    
    // 按action分组统计
    const [actionStats] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT action, COUNT(*) as count FROM ip_access_logs GROUP BY action ORDER BY count DESC"
    );
    console.log("\n  按操作类型统计:");
    actionStats.forEach(stat => {
      console.log(`    ${stat.action}: ${stat.count} 次`);
    });
    
    // 按IP分组统计（前10个）
    const [ipStats] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT ip, COUNT(*) as count FROM ip_access_logs GROUP BY ip ORDER BY count DESC LIMIT 10"
    );
    console.log("\n  按IP统计（前10个）:");
    ipStats.forEach(stat => {
      console.log(`    ${stat.ip}: ${stat.count} 次`);
    });
    
    // 今日访问统计
    const [todayStats] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT 
        ip, 
        action,
        COUNT(*) as count 
      FROM ip_access_logs 
      WHERE DATE(createdAt) = CURDATE()
      GROUP BY ip, action 
      ORDER BY count DESC 
      LIMIT 20`
    );
    console.log("\n  今日访问统计（前20条）:");
    if (todayStats.length > 0) {
      todayStats.forEach(stat => {
        console.log(`    IP: ${stat.ip}, 操作: ${stat.action}, 次数: ${stat.count}`);
      });
    } else {
      console.log("    无今日记录");
    }
    
    // 查询最近的访问记录（前20条）
    console.log("\n" + "=".repeat(60));
    console.log("最近的访问记录（前20条）:");
    console.log("=".repeat(60));
    const [recentLogs] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM ip_access_logs ORDER BY createdAt DESC LIMIT 20"
    );
    if (recentLogs.length > 0) {
      recentLogs.forEach((log, index) => {
        console.log(`\n  [${index + 1}]`);
        console.log(`    ID: ${log.id}`);
        console.log(`    IP: ${log.ip}`);
        console.log(`    操作: ${log.action}`);
        console.log(`    路径: ${log.path || 'N/A'}`);
        console.log(`    用户ID: ${log.userId || '未登录'}`);
        console.log(`    时间: ${log.createdAt}`);
      });
    } else {
      console.log("  无记录");
    }
    
    await connection.end();
    console.log("\n✅ 查询完成！");
  } catch (error) {
    console.error("❌ 查询失败:", error);
    process.exit(1);
  }
}

checkData();

