import { desc, eq, inArray, and, sql } from "drizzle-orm";
import { clawAdoptions, clawCollabSettings, clawCollabRequests, InsertClawCollabSetting, ClawCollabSetting, InsertClawCollabRequest, ClawCollabRequest } from "../../drizzle/schema";
import { getDb } from "./connection";

// ══════════════════════════════════════════════════════════════════
// 组织协作 - claw_collab_settings
// ══════════════════════════════════════════════════════════════════

export async function getCollabSettings(adoptionId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(clawCollabSettings).where(eq(clawCollabSettings.adoptionId, adoptionId)).limit(1);
  return rows[0] || null;
}

export async function upsertCollabSettings(
  adoptionId: number,
  payload: Partial<Omit<InsertClawCollabSetting, "id" | "adoptionId" | "createdAt" | "updatedAt">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getCollabSettings(adoptionId);
  if (existing) {
    await db.update(clawCollabSettings).set(payload).where(eq(clawCollabSettings.adoptionId, adoptionId));
    return await getCollabSettings(adoptionId);
  }
  await db.insert(clawCollabSettings).values({ adoptionId, ...payload });
  return await getCollabSettings(adoptionId);
}

// 获取组织内可见的协作目录（visibilityMode != private）
export async function listCollabDirectory(excludeAdoptionId?: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        adoptionId: clawCollabSettings.adoptionId,
        displayName: clawCollabSettings.displayName,
        headline: clawCollabSettings.headline,
        visibilityMode: clawCollabSettings.visibilityMode,
        acceptDm: clawCollabSettings.acceptDm,
        acceptTask: clawCollabSettings.acceptTask,
        allowedTaskTypes: clawCollabSettings.allowedTaskTypes,
        sharingPolicy: clawCollabSettings.sharingPolicy,
        // 从 clawAdoptions 关联 adoptId（公开用）
        adoptId: clawAdoptions.adoptId,
        permissionProfile: clawAdoptions.permissionProfile,
      })
      .from(clawCollabSettings)
      .innerJoin(clawAdoptions, eq(clawCollabSettings.adoptionId, clawAdoptions.id))
      .where(
        excludeAdoptionId
          ? and(
              inArray(clawCollabSettings.visibilityMode, ["org", "public"]),
              sql`${clawCollabSettings.adoptionId} != ${excludeAdoptionId}`
            )
          : inArray(clawCollabSettings.visibilityMode, ["org", "public"])
      );
    return rows;
  } catch (error) {
    console.error("[Database] Failed to list collab directory:", error);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════
// 组织协作 - claw_collab_requests
// ══════════════════════════════════════════════════════════════════

export async function createCollabRequest(payload: Omit<InsertClawCollabRequest, "id" | "createdAt" | "updatedAt" | "approvedAt" | "completedAt" | "resultSummary">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clawCollabRequests).values(payload);
  return Number(result[0].insertId);
}

export async function getCollabRequest(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(clawCollabRequests).where(eq(clawCollabRequests.id, id)).limit(1);
  return rows[0] || null;
}

export async function updateCollabRequest(
  id: number,
  patch: Partial<Pick<ClawCollabRequest, "status" | "resultSummary" | "approvedAt" | "completedAt">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(clawCollabRequests).set(patch as any).where(eq(clawCollabRequests.id, id));
}

// 获取发给我的协作请求（我是 target）
export async function listIncomingCollabRequests(targetAdoptId: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  // 两步：先取请求列表，再批量查 displayName
  const rows = await db
    .select()
    .from(clawCollabRequests)
    .where(eq(clawCollabRequests.targetAdoptId, targetAdoptId))
    .orderBy(desc(clawCollabRequests.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  // 批量查发起方 adoptionId，再查 settings
  const requesterAdoptIds = [...new Set(rows.map(r => r.requesterAdoptId))];
  const adoptionRows = await db
    .select({ id: clawAdoptions.id, adoptId: clawAdoptions.adoptId })
    .from(clawAdoptions)
    .where(inArray(clawAdoptions.adoptId, requesterAdoptIds));
  const adoptionIdMap = new Map(adoptionRows.map(a => [a.adoptId, a.id]));
  const adoptionIds = adoptionRows.map(a => a.id);
  const settingsRows = adoptionIds.length > 0
    ? await db.select({ adoptionId: clawCollabSettings.adoptionId, displayName: clawCollabSettings.displayName })
        .from(clawCollabSettings).where(inArray(clawCollabSettings.adoptionId, adoptionIds))
    : [];
  const displayNameMap = new Map(settingsRows.map(s => [s.adoptionId, s.displayName]));
  return rows.map(r => ({
    ...r,
    requesterDisplayName: displayNameMap.get(adoptionIdMap.get(r.requesterAdoptId) ?? -1) || null,
  }));
}

// 获取我发出的协作请求（我是 requester）
// 批量查 adoptId -> displayName（用于协作界面展示，避免暴露 adoptId）
export async function listCollabDisplayNames(adoptIds: string[]): Promise<Map<string, string>> {
  if (!adoptIds || adoptIds.length === 0) return new Map();
  const db = await getDb();
  if (!db) return new Map();
  const adoptionRows = await db
    .select({ id: clawAdoptions.id, adoptId: clawAdoptions.adoptId })
    .from(clawAdoptions)
    .where(inArray(clawAdoptions.adoptId, adoptIds));
  const adoptionIds = adoptionRows.map(a => a.id);
  if (adoptionIds.length === 0) return new Map();
  const settingsRows = await db
    .select({ adoptionId: clawCollabSettings.adoptionId, displayName: clawCollabSettings.displayName })
    .from(clawCollabSettings)
    .where(inArray(clawCollabSettings.adoptionId, adoptionIds));
  const idToDisplay = new Map(settingsRows.map(s => [s.adoptionId, s.displayName || ""]));
  const result = new Map<string, string>();
  for (const a of adoptionRows) {
    const name = idToDisplay.get(a.id);
    if (name) result.set(a.adoptId, name);
  }
  return result;
}

export async function listOutgoingCollabRequests(requesterAdoptId: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(clawCollabRequests)
    .where(eq(clawCollabRequests.requesterAdoptId, requesterAdoptId))
    .orderBy(desc(clawCollabRequests.createdAt))
    .limit(limit);
}
