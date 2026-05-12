import { sql } from "drizzle-orm";
import { getDb } from "../server/db/connection";

function rowsFrom(result: any): any[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return [];
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const duplicateRows = rowsFrom(await (db as any).execute(sql.raw("SELECT name, COUNT(*) AS c FROM lx_collab_spaces GROUP BY name HAVING COUNT(*) > 1")));
  if (duplicateRows.length > 0) {
    console.error("[COLLAB-MIGRATE] duplicate space names found, aborting:", duplicateRows);
    process.exit(1);
  }

  const indexRows = rowsFrom(await (db as any).execute(sql.raw("SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'lx_collab_spaces' AND index_name = 'uk_lx_collab_spaces_name'")));
  const exists = Number(indexRows[0]?.c || 0) > 0;
  if (exists) {
    console.log("[COLLAB-MIGRATE] unique index already exists");
    process.exit(0);
  }

  await (db as any).execute(sql.raw("ALTER TABLE lx_collab_spaces ADD UNIQUE KEY uk_lx_collab_spaces_name (name)"));
  console.log("[COLLAB-MIGRATE] added uk_lx_collab_spaces_name");
  process.exit(0);
}

main().catch((error) => {
  console.error("[COLLAB-MIGRATE] failed", error);
  process.exit(1);
});
