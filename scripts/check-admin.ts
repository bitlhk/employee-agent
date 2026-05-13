/**
 * 检查数据库中的管理员账号
 */

import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function checkAdmin() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    // 查询所有管理员用户
    const adminUsers = await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"));

    console.log("\n=== 管理员账号列表 ===");
    if (adminUsers.length === 0) {
      console.log("❌ 当前没有管理员账号");
      console.log("\n要创建管理员账号，请执行以下步骤：");
      console.log("1. 先注册一个普通账号（通过页面注册）");
      console.log("2. 然后在数据库中执行：");
      console.log("   UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';");
    } else {
      adminUsers.forEach((user, index) => {
        console.log(`\n管理员 ${index + 1}:`);
        console.log(`  邮箱: ${user.email || "无"}`);
        console.log(`  姓名: ${user.name || "无"}`);
        console.log(`  ID: ${user.id}`);
        console.log(`  登录方式: ${user.loginMethod || "无"}`);
      });
    }

    // 查询所有用户
    const allUsers = await db.select().from(users);
    console.log(`\n=== 所有用户 (共 ${allUsers.length} 个) ===`);
    allUsers.forEach((user, index) => {
      console.log(`\n用户 ${index + 1}:`);
      console.log(`  邮箱: ${user.email || "无"}`);
      console.log(`  姓名: ${user.name || "无"}`);
      console.log(`  角色: ${user.role}`);
      console.log(`  ID: ${user.id}`);
    });

    process.exit(0);
  } catch (error) {
    console.error("查询失败:", error);
    process.exit(1);
  }
}

checkAdmin();

