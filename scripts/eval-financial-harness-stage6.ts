import fs from "node:fs";
import path from "node:path";

type ExpectedTemplateId = "market-researcher" | "meeting-prep-agent" | "clarify" | "reject_or_reframe";
type ExpectedIntent = "run_template" | "clarify" | "unsupported";

type EvalCase = {
  id: string;
  prompt: string;
  expectedTemplateId: ExpectedTemplateId;
  expectedIntent: ExpectedIntent;
};

const endpoint = (
  process.env.TASK_WORKBENCH_HARNESS_ENDPOINT
  || process.env.LINGXIA_FIN_HARNESS_ENDPOINT
  || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT
  || process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT
  || "http://127.0.0.1:8670"
).replace(/\/+$/, "");
const token = process.env.TASK_WORKBENCH_HARNESS_TOKEN
  || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN
  || process.env.FIN_HARNESS_EXECUTOR_KEY
  || process.env.HERMES_HTTP_KEY
  || "";
const dataPathArg = process.argv.find((item) => item.startsWith("--data="));
const dataPath = dataPathArg
  ? dataPathArg.split("=", 2)[1]
  : "server/_core/agent/data/financial-harness-route-eval.seed.json";
const limitArg = process.argv.find((item) => item.startsWith("--limit="));
const timeoutArg = process.argv.find((item) => item.startsWith("--timeout-ms="));
const requestTimeoutMs = timeoutArg ? Math.max(5_000, Number(timeoutArg.split("=", 2)[1]) || 90_000) : 90_000;
const failThresholdArg = process.argv.find((item) => item.startsWith("--min-pass-rate="));
const minPassRate = failThresholdArg ? Math.max(0, Math.min(1, Number(failThresholdArg.split("=", 2)[1]) || 0)) : 0.9;

function readCases(): EvalCase[] {
  const resolved = path.resolve(process.cwd(), dataPath);
  const payload = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const cases = Array.isArray(payload?.cases) ? payload.cases : [];
  const selected = limitArg ? cases.slice(0, Math.max(1, Number(limitArg.split("=", 2)[1]) || cases.length)) : cases;
  return selected.map((item: any) => ({
    id: String(item.id),
    prompt: String(item.prompt),
    expectedTemplateId: item.expectedTemplateId,
    expectedIntent: item.expectedIntent,
  }));
}

function headers() {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function postJson(routePath: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${endpoint}${routePath}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${routePath} HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
    return payload as any;
  } finally {
    clearTimeout(timer);
  }
}

function intentFromTemplate(templateId?: string): ExpectedIntent {
  if (templateId === "clarify") return "clarify";
  if (templateId === "reject_or_reframe") return "unsupported";
  return "run_template";
}

function planProfilesOk(templateId: string, plan: any[]) {
  const allowed: Record<string, string[]> = {
    "market-researcher": ["market-sector-reader", "market-comps-spreader", "market-note-writer"],
    "meeting-prep-agent": ["meeting-news-reader", "meeting-profiler", "meeting-pack-writer"],
  };
  if (templateId === "clarify" || templateId === "reject_or_reframe") return Array.isArray(plan) && plan.length === 0;
  const expected = allowed[templateId] || [];
  const profiles = Array.isArray(plan) ? plan.map((item) => item?.profile).filter(Boolean) : [];
  return expected.every((profile) => profiles.includes(profile)) && profiles.every((profile) => expected.includes(profile));
}

async function evalOne(item: EvalCase) {
  const route = await postJson("/v1/harness/route", {
    prompt: item.prompt,
    selected_template_id: null,
    available_templates: ["market-researcher", "meeting-prep-agent"],
  });
  const result = route.result || route;
  const templateId = result.template_id;
  const intent = intentFromTemplate(templateId);
  const plan = Array.isArray(result.plan) ? result.plan : [];
  const ok = templateId === item.expectedTemplateId
    && intent === item.expectedIntent
    && planProfilesOk(templateId, plan);
  return {
    id: item.id,
    ok,
    expectedTemplateId: item.expectedTemplateId,
    templateId,
    expectedIntent: item.expectedIntent,
    intent,
    confidence: result.confidence,
    planProfiles: plan.map((stage: any) => stage?.profile).filter(Boolean).join(" > "),
    reason: result.reason || "",
    clarification: result.clarification_question || "",
    error: route.error || "",
  };
}

async function main() {
  if (!token) throw new Error("Missing TASK_WORKBENCH_HARNESS_TOKEN, FIN_HARNESS_EXECUTOR_KEY, or HERMES_HTTP_KEY");
  const cases = readCases();
  if (!cases.length) throw new Error(`No eval cases found at ${dataPath}`);
  const started = Date.now();
  const rows = [];
  for (const [index, item] of cases.entries()) {
    console.log(`[stage6] ${index + 1}/${cases.length} ${item.id}`);
    try {
      rows.push(await evalOne(item));
    } catch (error: any) {
      rows.push({
        id: item.id,
        ok: false,
        expectedTemplateId: item.expectedTemplateId,
        templateId: "",
        expectedIntent: item.expectedIntent,
        intent: "",
        confidence: "",
        planProfiles: "",
        reason: "",
        clarification: "",
        error: error?.name === "AbortError" ? `timeout after ${requestTimeoutMs}ms` : error?.message || String(error),
      });
    }
  }
  const passed = rows.filter((item) => item.ok).length;
  const passRate = passed / rows.length;
  console.table(rows.map((item) => ({
    id: item.id,
    ok: item.ok ? "ok" : "fail",
    expected: item.expectedTemplateId,
    actual: item.templateId,
    confidence: item.confidence,
    profiles: item.planProfiles,
    error: item.error ? String(item.error).slice(0, 60) : "",
  })));
  console.log(JSON.stringify({
    endpoint,
    dataPath,
    passed,
    total: rows.length,
    passRate,
    minPassRate,
    durationMs: Date.now() - started,
  }, null, 2));
  if (passRate < minPassRate) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
