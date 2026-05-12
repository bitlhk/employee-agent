import mysql from "mysql2/promise";
import "dotenv/config";

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;

const statements = [
  `CREATE TABLE IF NOT EXISTS lx_collab_spaces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    status ENUM('active','disabled') NOT NULL DEFAULT 'active',
    sort_order INT NOT NULL DEFAULT 99,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lx_collab_user_profiles (
    user_id INT PRIMARY KEY,
    real_name VARCHAR(100) NULL,
    organization_name VARCHAR(200) NULL,
    department_name VARCHAR(200) NULL,
    space_id INT NULL,
    status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    INDEX idx_lx_collab_user_profiles_space_status (space_id, status),
    INDEX idx_lx_collab_user_profiles_org (organization_name),
    INDEX idx_lx_collab_user_profiles_dept (department_name)
  )`,
];

console.log(`[COLLAB-MIGRATE] Phase 1 collaboration isolation schema ${apply ? "apply" : "dry-run"}`);
for (const sql of statements) {
  console.log("---");
  console.log(sql.trim());
}

if (!apply) {
  console.log("[COLLAB-MIGRATE] dry-run only. Re-run with --apply to execute.");
  process.exit(0);
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for --apply");
}

const conn = await mysql.createConnection(databaseUrl);
try {
  for (const sql of statements) {
    await conn.query(sql);
  }
  console.log("[COLLAB-MIGRATE] applied successfully");
} finally {
  await conn.end();
}