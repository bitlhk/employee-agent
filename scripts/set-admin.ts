/**
 * 设置用户为管理员
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq, like } from "drizzle-orm";

async function setAdminByName(name: string) {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    // 先查询用户是否存在（支持模糊匹配姓名）
    const userList = await db
      .select()
      .from(users)
      .where(like(users.name, `%${name}%`))
      .limit(10);

    if (userList.length === 0) {
      console.error(`❌ 未找到姓名包含 "${name}" 的用户`);
      process.exit(1);
    }

    if (userList.length > 1) {
      console.log(`找到 ${userList.length} 个匹配的用户：`);
      userList.forEach((u, i) => {
        console.log(`  ${i + 1}. ${u.name || "无"} (${u.email || "无邮箱"}) - ${u.role}`);
      });
      console.error(`\n❌ 请提供更精确的姓名或使用邮箱地址`);
      process.exit(1);
    }

    const currentUser = userList[0];
    
    if (currentUser.role === "admin") {
      console.log(`✅ 用户 ${currentUser.name} (${currentUser.email}) 已经是管理员了`);
      process.exit(0);
    }

    // 更新用户角色为管理员
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, currentUser.id));

    console.log(`✅ 成功将用户设置为管理员`);
    console.log(`   姓名: ${currentUser.name || "无"}`);
    console.log(`   邮箱: ${currentUser.email || "无"}`);
    console.log(`   用户ID: ${currentUser.id}`);
    
    process.exit(0);
  } catch (error) {
    console.error("设置失败:", error);
    process.exit(1);
  }
}

async function setAdminByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    // 先查询用户是否存在
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0) {
      console.error(`❌ 用户 ${email} 不存在`);
      process.exit(1);
    }

    const currentUser = user[0];
    
    if (currentUser.role === "admin") {
      console.log(`✅ 用户 ${email} 已经是管理员了`);
      process.exit(0);
    }

    // 更新用户角色为管理员
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.email, email));

    console.log(`✅ 成功将用户 ${email} 设置为管理员`);
    console.log(`   姓名: ${currentUser.name || "无"}`);
    console.log(`   用户ID: ${currentUser.id}`);
    
    process.exit(0);
  } catch (error) {
    console.error("设置失败:", error);
    process.exit(1);
  }
}

// 从命令行参数获取，支持邮箱或姓名
const input = process.argv[2];

if (!input) {
  console.error("❌ 请提供邮箱地址或姓名");
  console.log("用法: tsx scripts/set-admin.ts <邮箱或姓名>");
  console.log("示例: tsx scripts/set-admin.ts user@example.com");
  console.log("示例: tsx scripts/set-admin.ts \"Hongkun Li\"");
  process.exit(1);
}

// 判断是邮箱还是姓名（简单判断：包含@就是邮箱）
if (input.includes("@")) {
  console.log(`正在将 ${input} 设置为管理员...`);
  setAdminByEmail(input);
} else {
  console.log(`正在查找姓名包含 "${input}" 的用户并设置为管理员...`);
  setAdminByName(input);
}

