import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let _db: ReturnType<typeof drizzle> | null = null;
let _connection: mysql.Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.warn("[Database] DATABASE_URL is not set. Database operations will fail.");
    return null;
  }

  if (!_db) {
    try {
      // 创建连接池
      const connection = mysql.createPool({
        uri: databaseUrl,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // 连接超时设置
        connectTimeout: 60000, // 60秒连接超时
        // 启用 TCP keepalive 以保持连接活跃
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });

      connection.on('connection', (conn) => {
        conn.on('error', (err) => {
          console.error('[Database] Connection error:', err);
          if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
            console.warn('[Database] Connection lost, will reconnect on next query');
          }
        });
      });

      // 监听连接池错误
      (connection as any).on('error', (err: any) => {
        console.error('[Database] Pool error:', err);
      });

      _connection = connection;
      _db = drizzle(connection) as any;

      // 测试连接
      await connection.query("SELECT 1");
      console.log("[Database] Connected successfully");

      // 定期检查连接健康（每5分钟）
      setInterval(async () => {
        try {
          await connection.query("SELECT 1");
        } catch (error) {
          console.error("[Database] Health check failed:", error);
        }
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      _db = null;
      _connection = null;
      // 不抛出错误，让调用者处理
    }
  }

  return _db;
}
