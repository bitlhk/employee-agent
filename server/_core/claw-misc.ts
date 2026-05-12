import express from "express";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { strictLimiter } from "./security";
import { APP_ROOT, OPENCLAW_JSON_PATH, openClawAgentDir, openClawSkillMarketDir, openClawWorkspaceDir, requireClawOwner } from "./helpers";
import { createContext } from "./context";
import { skillInstaller } from "./skills/skill-installer";
import { MAX_SKILL_PACKAGE_BYTES, parseSkillPackageBuffer } from "./skills/skill-source";

export function registerMiscRoutes(app: express.Express) {

  // ── Runtime info ──────────────────────────────────────
  app.get("/api/claw/runtime-info", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const dbAgentId = String((claw as any).agentId || "").trim();
      const trialAgentId = `trial_${String(adoptId)}`;
      const trialAgentDir = openClawAgentDir(trialAgentId);
      const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : dbAgentId;
      const skillsDir = `${openClawWorkspaceDir(runtimeAgentId)}/skills`;
      res.json({ adoptId, dbAgentId, runtimeAgentId, skillsDir, trialAgentDirExists: existsSync(trialAgentDir) });
    } catch (e) {
      res.status(500).json({ error: "runtime info failed" });
    }
  });

  // ── 每日洞察 API ──────────────────────────────────────
  app.get("/api/insights/latest", async (_req, res) => {
    try {
      const { getLatestDailyInsight } = await import("../db");
      const insight = await getLatestDailyInsight();
      if (!insight) {
        res.status(404).json({ error: "No insight found" });
        return;
      }
      res.json({
        id: insight.id,
        date: insight.date,
        title: insight.title,
        summary: insight.summary,
        content: insight.content,
        source: insight.source,
        updatedAt: insight.updatedAt,
      });
    } catch (error) {
      console.error("[Insights] Failed to get latest insight:", error);
      res.status(500).json({ error: "Failed to get latest insight" });
    }
  });

  app.post("/api/insights/upsert", strictLimiter, async (req, res) => {
    try {
      const expectedToken = process.env.INSIGHTS_PUSH_TOKEN;
      const tokenFromHeader = req.header("x-insights-token") || req.header("authorization")?.replace(/^Bearer\s+/i, "");

      if (!expectedToken || tokenFromHeader !== expectedToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = req.body || {};
      const date = typeof body.date === "string" ? body.date.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const source = typeof body.source === "string" ? body.source.trim() : "openclaw";

      if (!date || !title || !content) {
        res.status(400).json({ error: "date/title/content are required" });
        return;
      }

      const { upsertDailyInsight } = await import("../db");
      await upsertDailyInsight({ date, title, summary, content, source });

      res.json({ success: true });
    } catch (error) {
      console.error("[Insights] Failed to upsert insight:", error);
      res.status(500).json({ error: "Failed to upsert insight" });
    }
  });

  // ── Logout all sessions/cookies ───────────────────────
  app.post("/api/auth/logout-all", async (req, res) => {
    try {
      const clearOpts = [
        { path: "/" },
        { domain: process.env.COOKIE_DOMAIN || ".linggan.top", path: "/" },
        { domain: (process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, ""), path: "/" },
        { domain: `www.${(process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, "")}`, path: "/" },
      ] as const;

      for (const opt of clearOpts) {
        try { res.clearCookie("app_session_id", { ...opt, httpOnly: true, secure: true, sameSite: "none" as const }); } catch {}
        try { res.clearCookie("app_session_id", { ...opt, httpOnly: true, secure: false, sameSite: "lax" as const }); } catch {}
      }

      // lock sso-bridge for 3 minutes to avoid immediate auto-login after logout
      res.cookie("logout_lock", "1", {
        domain: process.env.COOKIE_DOMAIN || ".linggan.top",
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
        maxAge: 3 * 60 * 1000,
      });

      // best-effort site data clear (supported browsers only)
      res.setHeader("Clear-Site-Data", '"cookies", "storage"');
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false });
    }
  });

  // ── Embed auth probe for nginx auth_request ───────────
  app.get("/api/embed/auth-check", async (req, res) => {
    try {
      const context = await createContext({ req, res, info: {} as any });
      if (context.user) {
        res.status(204).end();
      } else {
        res.status(401).json({ error: "UNAUTHORIZED" });
      }
    } catch (e) {
      res.status(401).json({ error: "UNAUTHORIZED" });
    }
  });

  // ── SSO bridge ────────────────────────────────────────
  app.get("/api/embed/sso-bridge", async (req, res) => {
    try {
      const nextRaw = typeof req.query.next === "string" ? req.query.next : (process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/"));
      let nextUrl: URL;
      try {
        nextUrl = new URL(nextRaw);
      } catch {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      // only allow configured domain destinations
      if (!nextUrl.hostname.endsWith((process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, ""))) {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      // If user just logged out, skip auto-bridge to avoid immediate re-login loop
      if ((req as any).cookies?.logout_lock === "1") {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      const context = await createContext({ req, res, info: {} as any });
      if (!context.user) {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      const { sdk } = await import("./sdk");
      
      const token = await sdk.signSession({
        userId: context.user.id,
        name: context.user.name ?? "",
      });

      // shared cookie for subdomains
      res.cookie("app_session_id", token, {
        domain: process.env.COOKIE_DOMAIN || ".linggan.top",
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
      });

      return res.redirect(nextUrl.toString());
    } catch (e) {
      return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
    }
  });

  // ── AI 审核技能包 ───────────────────────────────────
  app.post("/api/claw/admin/ai-review-skill", async (req, res) => {
    try {
      // 简单鉴权：检查 cookie 中的 session
      const { getSkillMarketItem: getSMI } = await import("../db");

      const { skillMarketId } = req.body || {};
      if (!skillMarketId) { res.status(400).json({ error: "Missing skillMarketId" }); return; }

      const item = await getSMI(Number(skillMarketId));
      if (!item) { res.status(404).json({ error: "技能不存在" }); return; }

      // 读取源码
      const dir = item.packagePath || "";
      let skillMd = "";
      let scriptFiles: string[] = [];
      let scriptContent = "";
      try { skillMd = readFileSync(`${dir}/SKILL.md`, "utf8"); } catch {}
      try {
        if (existsSync(`${dir}/scripts`)) {
          scriptFiles = readdirSync(`${dir}/scripts`);
          // 读取前 3 个脚本内容
          for (const f of scriptFiles.slice(0, 3)) {
            try {
              const c = readFileSync(`${dir}/scripts/${f}`, "utf8");
              scriptContent += `\n--- ${f} ---\n${c.slice(0, 2000)}\n`;
            } catch {}
          }
        }
      } catch {}

      const prompt = `审核此技能包，简要回答（200字内）：1.安全性 2.描述准确性 3.建议(通过/拒绝/需修改)\n\nSKILL.md(摘要):\n${skillMd.slice(0, 1000)}\n\n脚本: ${scriptFiles.join(",")}\n${scriptContent.slice(0, 1500)}`;

      // 调用 OpenClaw 的模型
      const OPENCLAW_JSON = OPENCLAW_JSON_PATH;
      let apiBase = "";
      let apiToken = "";
      let modelId = "";
      try {
        const cfg = JSON.parse(readFileSync(OPENCLAW_JSON, "utf8"));
        const providers = cfg?.models?.providers || {};
        for (const [pid, prov] of Object.entries<any>(providers)) {
          if ((prov?.baseURL || prov?.baseUrl) && prov?.apiKey) {
            apiBase = String(prov.baseURL || prov.baseUrl).replace(/\/$/, "");
            apiToken = String(prov.apiKey);
            const models = Array.isArray(prov.models) ? prov.models : [];
            modelId = models[0]?.id || models[0] || `${pid}/default`;
            if (typeof modelId === "object") modelId = (modelId as any).id || "";
            break;
          }
        }
      } catch {}

      if (!apiBase || !apiToken) {
        res.status(503).json({ error: "未配置模型，无法 AI 审核" });
        return;
      }

      // SSE 流式输出
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const chatUrl = apiBase.match(/\/v[0-9]/) ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
      const apiRes = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          max_tokens: 500,
        }),
      });

      if (!apiRes.ok || !apiRes.body) {
        res.write(`data: ${JSON.stringify({ error: "LLM 调用失败: " + apiRes.status })}\n\n`);
        res.end();
        return;
      }

      const reader = (apiRes.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); continue; }
          try {
            const d = JSON.parse(payload);
            const chunk = d.choices?.[0]?.delta?.content || "";
            if (chunk) res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          } catch {}
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("[ai-review]", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { try { res.end(); } catch {} }
    }
  });

  // ── 管理员上传开源社区技能包（zip）────────────────────
  app.post("/api/claw/skill-market/upload", async (req, res) => {
    try {
      const ctx = await createContext({ req, res } as any);
      if (!ctx.user || ctx.user.role !== "admin") {
        res.status(403).json({ error: "admin only" });
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        try {
          const buf = Buffer.concat(chunks);
          if (buf.length === 0) { res.status(400).json({ error: "No data" }); return; }
          if (buf.length > MAX_SKILL_PACKAGE_BYTES) { res.status(413).json({ error: "File too large (max 30MB)" }); return; }

          const filename = decodeURIComponent(String(req.header("x-skill-filename") || "uploaded.zip")).trim() || "uploaded.zip";
          const parsed = await parseSkillPackageBuffer(buf, filename);
          const marketDir = openClawSkillMarketDir();
          const uploadId = `upload-${Date.now()}`;
          const tmpZip = path.join("/tmp", `${uploadId}.zip`);
          const finalDir = path.join(marketDir, "pending", `${parsed.skillId}-${uploadId}`);

          writeFileSync(tmpZip, buf);
          try {
            skillInstaller.installFromSource(tmpZip, finalDir);
          } finally {
            try { rmSync(tmpZip, { force: true }); } catch {}
          }

          const { insertSkillMarketItem } = await import("../db");
          const marketItemId = await insertSkillMarketItem({
            skillId: parsed.skillId,
            name: parsed.displayName || parsed.skillId,
            description: parsed.description || null,
            author: "管理员上传",
            authorUserId: ctx.user!.id,
            version: String(parsed.manifest?.version || "1.0.0"),
            category: "general",
            origin: "opensource",
            status: "pending",
            license: String(parsed.manifest?.license || "MIT"),
            packagePath: finalDir,
          });

          res.json({
            ok: true,
            uploadId: parsed.skillId,
            name: parsed.displayName || parsed.skillId,
            description: parsed.description || "",
            path: finalDir,
            marketItemId,
            warnings: parsed.warnings,
          });
        } catch (err: any) {
          console.error("[skill-market upload] failed", err);
          res.status(400).json({ error: String(err?.message || "技能包解析失败") });
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ── 智能体使用量统计（从 claw-exec.log 解析）──
  app.get("/api/claw/admin/usage-stats", async (req, res) => {
    try {
      // 简单鉴权
      const { createContext } = await import("./context");
      const ctx = await createContext({ req, res } as any);
      if (!ctx.user || ctx.user.role !== "admin") {
        return res.status(403).json({ error: "admin only" });
      }

      const { readFileSync, existsSync } = await import("fs");
      const logPath = APP_ROOT + "/logs/claw-exec.log";
      if (!existsSync(logPath)) return res.json({ adoptions: [], daily: [], summary: {} });

      const raw = readFileSync(logPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);

      // 按 adoptId 统计
      const byAdopt: Record<string, { total: number; days: Record<string, number>; lastTs: string; userId: number }> = {};
      const dailyAll: Record<string, number> = {};

      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          const aid = d.adoptId || "";
          const day = (d.ts || "").slice(0, 10);
          const uid = d.userId || 0;
          if (!aid || !day) continue;

          if (!byAdopt[aid]) byAdopt[aid] = { total: 0, days: {}, lastTs: "", userId: uid };
          byAdopt[aid].total++;
          byAdopt[aid].days[day] = (byAdopt[aid].days[day] || 0) + 1;
          if (d.ts > byAdopt[aid].lastTs) { byAdopt[aid].lastTs = d.ts; byAdopt[aid].userId = uid; }

          dailyAll[day] = (dailyAll[day] || 0) + 1;
        } catch {}
      }

      // 查用户名
      let userMap: Record<number, string> = {};
      try {
        const { getDb } = await import("../db");
        const { users } = await import("../../drizzle/schema");
        const db = await getDb();
        if (db) {
          const allUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
          for (const u of allUsers) userMap[u.id] = u.name || u.email || String(u.id);
        }
      } catch {}

      // 构建排行
      const adoptions = Object.entries(byAdopt)
        .map(([adoptId, stat]) => ({
          adoptId,
          total: stat.total,
          userId: stat.userId,
          userName: userMap[stat.userId] || String(stat.userId),
          lastActivity: stat.lastTs,
          recent7d: Object.entries(stat.days)
            .filter(([d]) => d >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
            .reduce((s, [, c]) => s + c, 0),
          dailyBreakdown: Object.entries(stat.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14)
            .map(([date, count]) => ({ date, count })),
        }))
        .sort((a, b) => b.total - a.total);

      // 每日全局趋势（最近14天）
      const daily = Object.entries(dailyAll)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 14)
        .map(([date, count]) => ({ date, count }))
        .reverse();

      return res.json({
        adoptions,
        daily,
        summary: {
          totalClaws: adoptions.length,
          totalChats: lines.length,
          activeToday: adoptions.filter(a => a.dailyBreakdown.some(d => d.date === new Date().toISOString().slice(0, 10))).length,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

}
