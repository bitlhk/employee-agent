import { eq } from "drizzle-orm";
import { scenarios, Scenario, InsertScenario } from "../../drizzle/schema";
import { getDb } from "./connection";

// ============ 场景管理 ============

/**
 * 获取所有场景（公开接口，返回 active 状态）
 */
export async function getAllScenarios(): Promise<Scenario[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.status, "active"))
      .orderBy(scenarios.displayOrder);
  } catch (error) {
    console.error("[Database] Failed to get all scenarios:", error);
    return [];
  }
}

/**
 * 获取所有场景（管理员接口，返回全部）
 */
export async function getAllScenariosAdmin(): Promise<Scenario[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  try {
    return await db.select().from(scenarios).orderBy(scenarios.displayOrder);
  } catch (error) {
    console.error("[Database] Failed to get all scenarios admin:", error);
    return [];
  }
}

/**
 * 根据ID获取场景
 */
export async function getScenarioById(id: string): Promise<Scenario | null> {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const result = await db.select().from(scenarios).where(eq(scenarios.id, id));
    return result[0] || null;
  } catch (error) {
    console.error("[Database] Failed to get scenario:", error);
    return null;
  }
}

/**
 * 创建场景
 */
export async function createScenario(data: InsertScenario): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.insert(scenarios).values(data);
}

/**
 * 更新场景
 */
export async function updateScenario(id: string, data: Partial<InsertScenario>): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(scenarios).set(data).where(eq(scenarios.id, id));
}

/**
 * 删除场景
 */
export async function deleteScenario(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(scenarios).where(eq(scenarios.id, id));
}
