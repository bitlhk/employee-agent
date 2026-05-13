import "dotenv/config";
import mysql from "mysql2/promise";

async function debugCount() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(databaseUrl);
    
    const ip = "::1";
    console.log(`📊 调试IP: ${ip}\n`);
    
    // 获取服务器当前时间
    const [serverTime] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT NOW() as now, CURDATE() as today, DATE(NOW()) as date"
    );
    console.log("服务器时间:");
    console.log(`  NOW(): ${serverTime[0].now}`);
    console.log(`  CURDATE(): ${serverTime[0].today}`);
    console.log(`  DATE(NOW()): ${serverTime[0].date}\n`);
    
    // 查询所有 experience_click 记录（不限制日期）
    const [allClicks] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT id, ip, action, createdAt FROM ip_access_logs WHERE ip = ? AND action = 'experience_click' ORDER BY createdAt DESC LIMIT 20",
      [ip]
    );
    
    console.log(`总 experience_click 记录数: ${allClicks.length}\n`);
    
    if (allClicks.length > 0) {
      console.log("最近的记录:");
      allClicks.forEach((log, index) => {
        console.log(`  [${index + 1}] ID: ${log.id}, 时间: ${log.createdAt}`);
      });
    }
    
    // 使用 CURDATE() 查询今天的记录
    const [todayClicks] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM ip_access_logs WHERE ip = ? AND action = 'experience_click' AND DATE(createdAt) = CURDATE()",
      [ip]
    );
    
    console.log(`\n使用 CURDATE() 查询今天的记录数: ${todayClicks[0].count}`);
    
    // 使用 DATE(createdAt) = DATE(NOW()) 查询
    const [todayClicks2] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM ip_access_logs WHERE ip = ? AND action = 'experience_click' AND DATE(createdAt) = DATE(NOW())",
      [ip]
    );
    
    console.log(`使用 DATE(NOW()) 查询今天的记录数: ${todayClicks2[0].count}`);
    
    await connection.end();
  } catch (error) {
    console.error("❌ 调试失败:", error);
    process.exit(1);
  }
}

debugCount();

