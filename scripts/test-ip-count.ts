import "dotenv/config";
import mysql from "mysql2/promise";

async function testCount() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL 环境变量未设置");
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(databaseUrl);
    
    const ip = "::1";
    console.log(`📊 测试IP: ${ip}\n`);
    
    // 获取今天的开始和结束时间
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    
    console.log("时间范围:");
    console.log(`  开始: ${startOfDay.toISOString()}`);
    console.log(`  结束: ${endOfDay.toISOString()}\n`);
    
    // 查询所有 experience_click 记录
    const [allClicks] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM ip_access_logs 
       WHERE ip = ? AND action = 'experience_click' 
       ORDER BY createdAt DESC`
    );
    
    console.log(`总 experience_click 记录数: ${allClicks.length}\n`);
    
    // 查询今天的记录
    const [todayClicks] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM ip_access_logs 
       WHERE ip = ? 
         AND action = 'experience_click' 
         AND createdAt >= ? 
         AND createdAt < ?
       ORDER BY createdAt DESC`,
      [ip, startOfDay, endOfDay]
    );
    
    console.log(`今天的 experience_click 记录数: ${todayClicks.length}\n`);
    
    if (todayClicks.length > 0) {
      console.log("今天的记录详情:");
      todayClicks.forEach((log, index) => {
        console.log(`  [${index + 1}] ID: ${log.id}, 时间: ${log.createdAt}`);
      });
    }
    
    // 使用 COUNT 查询
    const [countResult] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM ip_access_logs 
       WHERE ip = ? 
         AND action = 'experience_click' 
         AND createdAt >= ? 
         AND createdAt < ?`,
      [ip, startOfDay, endOfDay]
    );
    
    console.log(`\nCOUNT 查询结果: ${countResult[0].count}`);
    
    await connection.end();
  } catch (error) {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  }
}

testCount();

