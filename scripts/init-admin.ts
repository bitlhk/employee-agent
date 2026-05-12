#!/usr/bin/env -S npx tsx
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "../server/db";

const args = process.argv.slice(2);

function arg(name: string, fallback = "") {
  const prefix = `--${name}=`;
  const inline = args.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0) return String(args[idx + 1] || "").trim();
  return fallback;
}

async function main() {
  const email = arg("email").toLowerCase();
  const password = arg("password");
  const name = arg("name", "Admin") || "Admin";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("missing or invalid --email=<admin@example.com>");
  }
  if (!password || password.length < 8) {
    throw new Error("missing --password=<strong password>, at least 8 chars");
  }

  const db = await getDb();
  if (!db) throw new Error("database unavailable; check DATABASE_URL");

  const hashed = await bcrypt.hash(password, 10);
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        name: existing[0].name || name,
        password: hashed,
        loginMethod: "email",
        role: "admin",
        accessLevel: "all",
        updatedAt: new Date(),
      } as any)
      .where(eq(users.email, email));
    console.log(`[INIT-ADMIN] updated existing admin: ${email}`);
    return;
  }

  const result = await db.insert(users).values({
    name,
    email,
    password: hashed,
    loginMethod: "email",
    role: "admin",
    accessLevel: "all",
    lastSignedIn: new Date(),
  } as any);
  console.log(`[INIT-ADMIN] created admin: ${email} id=${result[0].insertId}`);
}

main().catch((err) => {
  console.error(`[INIT-ADMIN] failed: ${err?.message || err}`);
  process.exit(1);
});
