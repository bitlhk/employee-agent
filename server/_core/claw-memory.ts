import express from "express";
import { parseAdoptId, parseMemoryTarget, parseWriteMode, sendError, handleRouteError } from "./schemas";
import path from "path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "fs";
import {
  requireClawOwner, resolveClawWorkspace, computeEtag, appendLogAsync,
  APP_ROOT,
} from "./helpers";
import { resolveHermesMemoryTarget } from "./hermes-memory";

export function registerMemoryRoutes(app: express.Express) {

  // ── Memory Write API (starter-safe, gateway-independent) ──
  const MEMORY_BUDGET_PATH = `${APP_ROOT}/data/claw-memory-budget.json`;
  const LIMIT_SINGLE_WRITE = 256 * 1024; // 256KB (2026-04-20 提到 per-file 上限, 64KB 挡住了用户 80KB+ 记忆文件 replace 写入)
  const LIMIT_MEMORY_FILE = 256 * 1024; // MEMORY.md
  const LIMIT_DAILY_FILE = 128 * 1024; // memory/YYYY-MM-DD.md
  const LIMIT_NOTES_FILE = 256 * 1024; // notes/*.md

  const loadBudget = (): any => {
    try {
      if (!existsSync(MEMORY_BUDGET_PATH)) return {};
      return JSON.parse(String(readFileSync(MEMORY_BUDGET_PATH, "utf8") || "{}") || "{}");
    } catch {
      return {};
    }
  };
  const saveBudget = (obj: any) => {
    try {
      mkdirSync(`${APP_ROOT}/data`, { recursive: true });
      writeFileSync(MEMORY_BUDGET_PATH, JSON.stringify(obj, null, 2), "utf8");
    } catch {}
  };

  const checkAndConsumeBudget = (adoptId: string, bytes: number) => {
    const now = Date.now();
    const minKey = Math.floor(now / 60000);
    const hourKey = Math.floor(now / 3600000);
    const dayKey = Math.floor(now / 86400000);
    const db = loadBudget();
    const row = db[adoptId] || { m: { k: minKey, c: 0, b: 0 }, h: { k: hourKey, c: 0, b: 0 }, d: { k: dayKey, c: 0, b: 0 } };

    if (row.m.k !== minKey) row.m = { k: minKey, c: 0, b: 0 };
    if (row.h.k !== hourKey) row.h = { k: hourKey, c: 0, b: 0 };
    if (row.d.k !== dayKey) row.d = { k: dayKey, c: 0, b: 0 };

    if (row.m.c >= 10) return { ok: false, reason: "rate_limited_minute" };
    if (row.h.b + bytes > 3 * 1024 * 1024) return { ok: false, reason: "rate_limited_hour_bytes" };  // 2026-04-20 2MB→3MB 对应 LIMIT_SINGLE_WRITE 提高
    if (row.d.b + bytes > 5 * 1024 * 1024) return { ok: false, reason: "storage_budget_exceeded" };

    row.m.c += 1; row.m.b += bytes;
    row.h.c += 1; row.h.b += bytes;
    row.d.c += 1; row.d.b += bytes;
    db[adoptId] = row;
    saveBudget(db);
    return { ok: true };
  };

  const resolveMemoryTarget = (workspace: string, target: string) => {
    const t = String(target || "").trim();
    if (t === "MEMORY.md") return { ok: true, path: `${workspace}/MEMORY.md`, max: LIMIT_MEMORY_FILE } as const;
    if (t === "DREAMS.md") return { ok: true, path: `${workspace}/DREAMS.md`, max: LIMIT_MEMORY_FILE } as const;

    const m = t.match(/^memory:(\d{4}-\d{2}-\d{2})$/);
    if (m) return { ok: true, path: `${workspace}/memory/${m[1]}.md`, max: LIMIT_DAILY_FILE } as const;

    const n = t.match(/^notes:([a-zA-Z0-9._-]+\.md)$/);
    if (n) return { ok: true, path: `${workspace}/notes/${n[1]}`, max: LIMIT_NOTES_FILE } as const;

    return { ok: false, reason: "path_not_allowed" } as const;
  };

  const auditMemoryWrite = (entry: any) => {
    appendLogAsync("claw-memory-write.log", { ts: new Date().toISOString(), ...entry });
  };

  app.get("/api/claw/memory/read", async (req, res) => {
    try {
      const adoptId = parseAdoptId(req.query.adoptId);
      const target = String(req.query.target || "").trim();
      if (!target) return sendError(res, "BAD_REQUEST", "target required");
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const r = adoptId.startsWith("lgh-")
        ? resolveHermesMemoryTarget(adoptId, target)
        : resolveMemoryTarget(resolveClawWorkspace(claw), target);
      if (!r.ok) return sendError(res, "BAD_REQUEST", "path_not_allowed");

      const content = existsSync(r.path) ? String(readFileSync(r.path, "utf8") || "") : "";
      const etag = computeEtag(content);
      const updatedAt = existsSync(r.path) ? statSync(r.path).mtime.toISOString() : null;
      return res.json({ adoptId, target, content, etag, updatedAt, exists: existsSync(r.path) });
    } catch {
      return sendError(res, "INTERNAL_ERROR", "memory_read_failed");
    }
  });

  app.post("/api/claw/memory/write", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = parseAdoptId(body.adoptId);
      const target = String(body.target || "").trim();
      const mode = parseWriteMode(body.mode);
      const content = String(body.content || "");
      const etag = String(body.etag || "").trim();
      if (!target) return sendError(res, "BAD_REQUEST", "target required");
      if (Buffer.byteLength(content, "utf8") > LIMIT_SINGLE_WRITE) return sendError(res, "PAYLOAD_TOO_LARGE", "write_too_large");

      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const r = adoptId.startsWith("lgh-")
        ? resolveHermesMemoryTarget(adoptId, target)
        : resolveMemoryTarget(resolveClawWorkspace(claw), target);
      if (!r.ok) return sendError(res, "BAD_REQUEST", "path_not_allowed");

      const before = existsSync(r.path) ? String(readFileSync(r.path, "utf8") || "") : "";
      const beforeEtag = computeEtag(before);
      if (etag && etag !== beforeEtag) return res.status(409).json({ error: "CONFLICT", reason: "etag_mismatch" });

      const budget = checkAndConsumeBudget(adoptId, Buffer.byteLength(content, "utf8"));
      if (!budget.ok) return res.status(429).json({ error: String((budget as any).reason || "rate_limited") });

      const after = mode === "append" ? `${before}${content}` : content;
      if (Buffer.byteLength(after, "utf8") > r.max) {
        auditMemoryWrite({ userId: Number((claw as any).userId || 0), adoptId, target, op: mode, bytes: Buffer.byteLength(content, "utf8"), fileSizeBefore: Buffer.byteLength(before, "utf8"), fileSizeAfter: Buffer.byteLength(after, "utf8"), result: "reject", reason: "file_too_large" });
        return res.status(413).json({ error: "file_too_large" });
      }

      mkdirSync(path.dirname(r.path), { recursive: true });
      writeFileSync(r.path, after, "utf8");
      const nextEtag = computeEtag(after);
      auditMemoryWrite({ userId: Number((claw as any).userId || 0), adoptId, target, op: mode, bytes: Buffer.byteLength(content, "utf8"), fileSizeBefore: Buffer.byteLength(before, "utf8"), fileSizeAfter: Buffer.byteLength(after, "utf8"), result: "success" });
      return res.json({ ok: true, adoptId, target, etag: nextEtag, updatedAt: statSync(r.path).mtime.toISOString() });
    } catch {
      return sendError(res, "INTERNAL_ERROR", "memory_write_failed");
    }
  });

  app.get("/api/claw/memory/list", async (req, res) => {
    try {
      const adoptId = parseAdoptId(req.query.adoptId);
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveClawWorkspace(claw);
      const items: Array<{ target: string; exists: boolean; updatedAt: string | null; size: number | null }> = [];

      const memPath = `${workspace}/MEMORY.md`;
      items.push({ target: "MEMORY.md", exists: existsSync(memPath), updatedAt: existsSync(memPath) ? statSync(memPath).mtime.toISOString() : null, size: existsSync(memPath) ? Number(statSync(memPath).size || 0) : null });

      const dreamsPath = `${workspace}/DREAMS.md`;
      if (existsSync(dreamsPath)) {
        items.push({ target: "DREAMS.md", exists: true, updatedAt: statSync(dreamsPath).mtime.toISOString(), size: Number(statSync(dreamsPath).size || 0) });
      }

      const mDir = `${workspace}/memory`;
      if (existsSync(mDir)) {
        for (const f of readdirSync(mDir)) {
          if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) {
            const fp = `${mDir}/${f}`;
            items.push({ target: `memory:${f.replace(/\.md$/, "")}`, exists: true, updatedAt: statSync(fp).mtime.toISOString(), size: Number(statSync(fp).size || 0) });
          }
        }
      }

      const nDir = `${workspace}/notes`;
      if (existsSync(nDir)) {
        for (const f of readdirSync(nDir)) {
          if (/^[a-zA-Z0-9._-]+\.md$/.test(f)) {
            const fp = `${nDir}/${f}`;
            items.push({ target: `notes:${f}`, exists: true, updatedAt: statSync(fp).mtime.toISOString(), size: Number(statSync(fp).size || 0) });
          }
        }
      }

      return res.json({ adoptId, items });
    } catch {
      return sendError(res, "INTERNAL_ERROR", "memory_list_failed");
    }
  });

}
