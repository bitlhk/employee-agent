import express from "express";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import {
  requireClawOwner,
  APP_ROOT,
} from "./helpers";

export function registerSkillConfigRoutes(app: express.Express) {

  const SKILL_CONFIG_PATH = `${APP_ROOT}/data/claw-skill-configs.json`;

  app.get("/api/claw/skill-config", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const skillId = String(req.query.skillId || "").trim();
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      let data: any = {};
      if (existsSync(SKILL_CONFIG_PATH)) {
        data = JSON.parse(readFileSync(SKILL_CONFIG_PATH, "utf-8") || "{}");
      }
      const key = `${adoptId}:${skillId}`;
      res.json({ config: data[key] || {} });
    } catch (_e) {
      res.status(500).json({ error: "read config failed" });
    }
  });

  app.post("/api/claw/skill-config", async (req, res) => {
    try {
      const body = req.body || {};
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      const config = body.config && typeof body.config === "object" ? body.config : {};
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      let data: any = {};
      if (existsSync(SKILL_CONFIG_PATH)) {
        data = JSON.parse(readFileSync(SKILL_CONFIG_PATH, "utf-8") || "{}");
      }
      const key = `${adoptId}:${skillId}`;
      data[key] = { ...(data[key] || {}), ...config, updatedAt: new Date().toISOString() };
      mkdirSync(`${APP_ROOT}/data`, { recursive: true });
      writeFileSync(SKILL_CONFIG_PATH, JSON.stringify(data, null, 2), "utf-8");
      res.json({ ok: true, config: data[key] });
    } catch (_e) {
      res.status(500).json({ error: "save config failed" });
    }
  });


  app.get("/api/claw/skill-bindings", async (req, res) => {
    try {
      const adoptId = String((req.query as any)?.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      let data: Record<string, any> = {};
      if (existsSync(SKILL_CONFIG_PATH)) {
        const raw = String(readFileSync(SKILL_CONFIG_PATH, "utf-8") || "").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed as Record<string, any>;
          }
        }
      }

      const bindings: Record<string, boolean> = {};
      for (const k of Object.keys(data)) {
        const v = data[k];
        if (k.startsWith(`${adoptId}:`)) {
          const sid = k.slice(adoptId.length + 1);
          if (typeof v?.enabledForAgent === "boolean") bindings[sid] = v.enabledForAgent;
        }
      }

      res.json({ bindings });
    } catch (e) {
      console.error("[skill-bindings] read failed", e);
      res.status(500).json({ error: "read bindings failed" });
    }
  });

  app.post("/api/claw/skill-binding", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      const enabledForAgent = !!body.enabledForAgent;
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      let data: Record<string, any> = {};
      if (existsSync(SKILL_CONFIG_PATH)) {
        const raw = String(readFileSync(SKILL_CONFIG_PATH, "utf-8") || "").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed as Record<string, any>;
          }
        }
      }

      const key = `${adoptId}:${skillId}`;
      data[key] = { ...(data[key] || {}), enabledForAgent, updatedAt: new Date().toISOString() };
      mkdirSync(`${APP_ROOT}/data`, { recursive: true });
      writeFileSync(SKILL_CONFIG_PATH, JSON.stringify(data, null, 2), "utf-8");

      res.json({ ok: true, enabledForAgent });
    } catch (e) {
      console.error("[skill-binding] save failed", e);
      res.status(500).json({ error: "save binding failed" });
    }
  });

}
