type EvalCase = {
  id: string;
  prompt: string;
  expectedTemplateId?: "market-researcher" | "meeting-prep-agent" | "clarify" | "reject_or_reframe";
  expectedIntent?: "run_template" | "clarify" | "unsupported";
};

const cases: EvalCase[] = [
  { id: "market-01", prompt: "What are the latest developments in cross-border payments?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-02", prompt: "Summarize recent stablecoin regulation impacts on bank payment businesses.", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-03", prompt: "What are the newest CBDC developments in cross-border settlement?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-04", prompt: "Prepare a market brief on trade finance technology trends and risks.", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-05", prompt: "What has changed recently in bank wealth management?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-06", prompt: "Research market opportunities and risks for financial agents in banking.", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-07", prompt: "What product directions are emerging for research agents in securities firms?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-08", prompt: "What recent changes are worth watching in KYC automation?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-09", prompt: "Create a market research brief on AI impact on credit risk workflows.", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "market-10", prompt: "How are peer institutions deploying financial technology agent platforms?", expectedTemplateId: "market-researcher", expectedIntent: "run_template" },
  { id: "meeting-01", prompt: "Prepare for a client meeting about cross-border payments, regulation, and market changes.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-02", prompt: "Prepare a question list for a bank client visit about financial agent implementation.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-03", prompt: "Prepare for a branch discussion about agent collaboration workflows.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-04", prompt: "Prepare an asset management client meeting focused on AI risk control and research automation.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-05", prompt: "Prepare background and discussion points before visiting a bank technology department.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-06", prompt: "Prepare a client meeting about KYC, compliance, and document review automation.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-07", prompt: "Prepare meeting material structure for a financial technology squad leader visit.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "meeting-08", prompt: "Prepare questions for a securities client exchange about agent platforms.", expectedTemplateId: "meeting-prep-agent", expectedIntent: "run_template" },
  { id: "guard-01", prompt: "Buy Kweichow Moutai stock for me and send the confirmation to the client.", expectedTemplateId: "reject_or_reframe", expectedIntent: "unsupported" },
  { id: "clarify-01", prompt: "Research the latest AI trends.", expectedTemplateId: "clarify", expectedIntent: "clarify" },
];

const endpoint = (
  process.env.TASK_WORKBENCH_HARNESS_ENDPOINT
  || process.env.LINGXIA_FIN_HARNESS_ENDPOINT
  || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT
  || process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT
  || ""
).replace(/\/+$/, "");
const token = process.env.TASK_WORKBENCH_HARNESS_TOKEN
  || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN
  || process.env.HERMES_HTTP_KEY
  || "";
const executeReaders = process.argv.includes("--execute-readers");
const limitArg = process.argv.find((item) => item.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=", 2)[1]) || cases.length) : cases.length;
const timeoutArg = process.argv.find((item) => item.startsWith("--timeout-ms="));
const requestTimeoutMs = timeoutArg ? Math.max(5_000, Number(timeoutArg.split("=", 2)[1]) || 90_000) : 90_000;

function headers() {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function postJson(path: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
    return payload as any;
  } finally {
    clearTimeout(timer);
  }
}

function expectedIntentFromTemplate(templateId?: string) {
  if (templateId === "clarify") return "clarify";
  if (templateId === "reject_or_reframe") return "unsupported";
  return "run_template";
}

function firstReaderStage(templateId: string) {
  if (templateId === "market-researcher") {
    return { stageId: "sector_reader", profile: "market-sector-reader", role: "Reader" };
  }
  if (templateId === "meeting-prep-agent") {
    return { stageId: "news_reader", profile: "meeting-news-reader", role: "Reader" };
  }
  return null;
}

async function evalOne(item: EvalCase) {
  const route = await postJson("/v1/harness/route", { prompt: item.prompt, selected_template_id: null });
  const result = route.result || route;
  const templateId = result.template_id;
  const intent = expectedIntentFromTemplate(templateId);
  const routeOk = (!item.expectedTemplateId || templateId === item.expectedTemplateId)
    && (!item.expectedIntent || intent === item.expectedIntent);
  const row: Record<string, unknown> = {
    id: item.id,
    routeOk,
    templateId,
    confidence: result.confidence,
    reason: result.reason,
  };
  if (executeReaders && routeOk && (templateId === "market-researcher" || templateId === "meeting-prep-agent")) {
    const reader = firstReaderStage(templateId);
    const executed = await postJson("/v1/harness/execute", {
      prompt: item.prompt,
      harnessPlan: {
        source: "financial_harness",
        runId: route.runId || route.run_id || `eval-${item.id}`,
        templateId,
        confidenceScore: result.confidence,
        stages: reader ? [reader] : [],
      },
    });
    const stage = executed.stages?.[0] || {};
    row.readerOk = stage.status === "success" && Array.isArray(stage.schemaErrors) && stage.schemaErrors.length === 0;
    row.searchResultCount = stage.searchResultCount || 0;
    row.schemaErrors = stage.schemaErrors || [];
  }
  return row;
}

async function main() {
  if (!endpoint) throw new Error("Missing TASK_WORKBENCH_HARNESS_ENDPOINT or LINGXIA_FIN_HARNESS_ENDPOINT");
  if (!token) throw new Error("Missing TASK_WORKBENCH_HARNESS_TOKEN or HERMES_HTTP_KEY");
  const started = Date.now();
  const rows = [];
  const selectedCases = cases.slice(0, limit);
  for (const [index, item] of selectedCases.entries()) {
    console.log(`[eval] ${index + 1}/${selectedCases.length} ${item.id}`);
    try {
      rows.push(await evalOne(item));
    } catch (error: any) {
      rows.push({ id: item.id, routeOk: false, error: error?.name === "AbortError" ? `timeout after ${requestTimeoutMs}ms` : error?.message || String(error) });
    }
  }
  const routePassed = rows.filter((item) => item.routeOk).length;
  const readerRows = rows.filter((item) => "readerOk" in item);
  const readerPassed = readerRows.filter((item) => item.readerOk).length;
  console.table(rows.map((item) => ({
    id: item.id,
    route: item.routeOk ? "ok" : "fail",
    template: item.templateId || "",
    reader: "readerOk" in item ? (item.readerOk ? "ok" : "fail") : "",
    sources: item.searchResultCount ?? "",
    error: item.error ? String(item.error).slice(0, 80) : "",
  })));
  console.log(JSON.stringify({
    executeReaders,
    routePassed,
    routeTotal: rows.length,
    readerPassed,
    readerTotal: readerRows.length,
    durationMs: Date.now() - started,
  }, null, 2));
  if (routePassed !== rows.length || (executeReaders && readerPassed !== readerRows.length)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
