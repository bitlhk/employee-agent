#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runSmokeV1, runSmokeV2 } from "./employee-agent-smoke-runner.mjs";
import { attachConsoleCollectors, createPlaywrightTabAdapter } from "./adapters/playwright-tab-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function boolArg(name, fallback = false) {
  if (process.argv.includes(`--${name}`)) return true;
  if (process.argv.includes(`--no-${name}`)) return false;
  return fallback;
}

function timestampId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

async function loadJsonIfExists(file) {
  if (!file) return {};
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function main() {
  const configPath = argValue("config", process.env.SMOKE_CONFIG || "");
  const config = await loadJsonIfExists(configPath);
  const baseUrl = argValue("base-url", process.env.SMOKE_BASE_URL || config.baseUrl || "http://127.0.0.1:15180");
  const adoptId = argValue("adopt-id", process.env.SMOKE_ADOPT_ID || config.adoptId || "lgc-ofnmjm4joj");
  const level = argValue("level", process.env.SMOKE_LEVEL || config.level || "v1").toLowerCase();
  const runId = argValue("run-id", process.env.SMOKE_RUN_ID || config.runId || `SMOKE-${level.toUpperCase()}-${timestampId()}`);
  const reportDir = argValue("report-dir", process.env.SMOKE_REPORT_DIR || config.reportDir || path.join(__dirname, "reports"));
  const headed = boolArg("headed", process.env.SMOKE_HEADED === "1" || config.headed === true);
  const channel = argValue("channel", process.env.SMOKE_BROWSER_CHANNEL || config.browserChannel || "chrome");
  const sessionCookie = argValue("session-cookie", process.env.SMOKE_SESSION_COOKIE || config.sessionCookie || "");

  await fs.mkdir(reportDir, { recursive: true });

  let browser;
  try {
    try {
      browser = await chromium.launch({ channel, headless: !headed });
    } catch {
      browser = await chromium.launch({ headless: !headed });
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (sessionCookie) {
      await context.addCookies([{
        name: "app_session_id",
        value: sessionCookie,
        domain: new URL(baseUrl).hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      }]);
    }

    const page = await context.newPage();
    const consoleErrors = attachConsoleCollectors(page);
    const tab = createPlaywrightTabAdapter(page, { consoleErrors });
    const result = level === "v2"
      ? await runSmokeV2({ tab, adoptId, baseUrl, runId, includeV1: config.includeV1 !== false })
      : await runSmokeV1({ tab, adoptId, baseUrl, runId });

    const jsonPath = path.join(reportDir, `${runId}.json`);
    const mdPath = path.join(reportDir, `${runId}.md`);
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
    await fs.writeFile(mdPath, result.markdown, "utf8");

    console.log(JSON.stringify({
      ok: result.ok,
      runId,
      counts: result.counts,
      report: mdPath,
      failures: result.cases.filter((item) => item.status === "fail").map((item) => ({
        name: item.name,
        reason: item.reason,
      })),
      warnings: result.cases.filter((item) => item.status === "warn").map((item) => ({
        name: item.name,
        reason: item.reason,
      })),
    }, null, 2));

    process.exitCode = result.ok ? 0 : 1;
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
