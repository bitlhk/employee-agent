import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, clawAdoptions, roleAssetGrants } from "../drizzle/schema";
import { buildSeedRoleAssetGrants } from "../server/_core/role-asset-grants";
import { getRoleSkillMcpBaseline, listAgentRoleTemplates } from "../server/_core/role-templates";
import { listMcpInvocationCounts } from "../server/db/agents";
import { getDb } from "../server/db/connection";
import { listRoleAssetGrants, resolveEffectiveRoleAssets } from "../server/db/role-assets";

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: unknown;
};

type Args = {
  baseUrl: string;
  skipHttp: boolean;
  json: boolean;
  adoptId?: string;
  pm2EnvId?: string;
};

const checks: CheckResult[] = [];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: process.env.P7_SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5180}`,
    skipHttp: false,
    json: false,
  };
  for (const item of argv) {
    if (item === "--skip-http") args.skipHttp = true;
    else if (item === "--json") args.json = true;
    else if (item.startsWith("--base-url=")) args.baseUrl = item.slice("--base-url=".length).replace(/\/+$/, "");
    else if (item.startsWith("--adopt-id=")) args.adoptId = item.slice("--adopt-id=".length);
    else if (item.startsWith("--pm2-env-id=")) args.pm2EnvId = item.slice("--pm2-env-id=".length);
  }
  return args;
}

async function loadPm2DatabaseUrl(pm2EnvId?: string): Promise<void> {
  if (!pm2EnvId) return;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("pm2", ["env", pm2EnvId], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const line = stdout.split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL: "));
    const value = line?.slice("DATABASE_URL: ".length).trim();
    if (value) process.env.DATABASE_URL = value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[P7 smoke] Failed to load DATABASE_URL from pm2 env ${pm2EnvId}: ${detail}`);
  }
}

function pass(name: string, detail?: unknown): void {
  checks.push({ name, ok: true, detail });
}

function fail(name: string, detail?: unknown): never {
  checks.push({ name, ok: false, detail });
  throw new Error(`${name} failed`);
}

function assertCheck(condition: unknown, name: string, detail?: unknown): void {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function asSet(values: string[]): Set<string> {
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
}

async function chooseAuditAdoptId(input?: string): Promise<string> {
  if (input) return input;
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db
    .select({ adoptId: clawAdoptions.adoptId })
    .from(clawAdoptions)
    .where(and(eq(clawAdoptions.status, "active"), eq(clawAdoptions.roleTemplate, "wealth-manager")))
    .limit(1);
  if (rows[0]?.adoptId) return rows[0].adoptId;
  const fallback = await db
    .select({ adoptId: clawAdoptions.adoptId })
    .from(clawAdoptions)
    .where(eq(clawAdoptions.status, "active"))
    .limit(1);
  if (fallback[0]?.adoptId) return fallback[0].adoptId;
  throw new Error("No active claw adoption found for audit smoke");
}

async function countMcpAudit(serverId: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.action, "mcp.tool.completed"),
      eq(auditEvents.resourceType, "mcp_server"),
      eq(auditEvents.resourceId, serverId),
    ));
  return Number(rows[0]?.count || 0);
}

async function postAuditSmoke(args: Args, adoptId: string): Promise<{ before: number; after: number; response: unknown }> {
  const before = await countMcpAudit("wealth_assistant_customer");
  const response = await fetch(`${args.baseUrl}/api/claw/audit/mcp-tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "mcp.tool.completed",
      mcpServer: "wealth_assistant_customer",
      toolName: "wealth_assistant_customer_list",
      adoptId,
      durationMs: 1,
      metadata: { smoke: "p7-role-permissions" },
    }),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    throw new Error(`audit ingest returned ${response.status}: ${text.slice(0, 300)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = await countMcpAudit("wealth_assistant_customer");
  return { before, after, response: body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadPm2DatabaseUrl(args.pm2EnvId);
  const db = await getDb();
  assertCheck(Boolean(db), "database available");

  const baseline = getRoleSkillMcpBaseline();
  const roles = listAgentRoleTemplates();
  const mvpRoles = roles.filter((role) => role.status === "mvp");
  assertCheck(baseline.schema.defaultRole === "general-assistant", "default role is general-assistant", baseline.schema.defaultRole);
  assertCheck(baseline.runtimePolicy.defaultRuntime === "openclaw", "default runtime is openclaw", baseline.runtimePolicy);
  assertCheck(mvpRoles.length === 6, "MVP role count is 6", mvpRoles.map((role) => role.id));

  const desiredSeed = buildSeedRoleAssetGrants(roles);
  const grants = await listRoleAssetGrants();
  const enabledGrantKeys = asSet(grants.filter((grant) => grant.enabled).map((grant) =>
    `${grant.roleKey}\0${grant.assetType}\0${grant.assetId}\0${grant.source}`
  ));
  const missingSeed = desiredSeed.filter((grant) =>
    !enabledGrantKeys.has(`${grant.roleKey}\0${grant.assetType}\0${grant.assetId}\0seed`)
  );
  assertCheck(missingSeed.length === 0, "all seed grants enabled in DB", {
    desired: desiredSeed.length,
    missing: missingSeed.slice(0, 10),
  });

  const grantRows = await db!.select({
    source: roleAssetGrants.source,
    enabled: roleAssetGrants.enabled,
    count: sql<number>`count(*)`,
  }).from(roleAssetGrants).groupBy(roleAssetGrants.source, roleAssetGrants.enabled);
  pass("role_asset_grants distribution", grantRows);

  const general = await resolveEffectiveRoleAssets("general-assistant");
  assertCheck(general.mcpServers.default.length === 0 && general.mcpServers.optional.length === 0, "general role has no MCP grants", general.mcpServers);
  assertCheck(general.skills.optional.length > 0, "general role has open-source optional skills", general.skills);

  const wealth = await resolveEffectiveRoleAssets("wealth-manager");
  assertCheck(wealth.mcpServers.default.includes("wealth_assistant_customer"), "wealth-manager has customer MCP", wealth.mcpServers);
  assertCheck(wealth.skills.default.includes("wealth-manager-assistant"), "wealth-manager has assistant skill", wealth.skills);

  const insurance = await resolveEffectiveRoleAssets("insurance-advisor");
  assertCheck(insurance.mcpServers.default.includes("insurance_kb"), "insurance-advisor has insurance_kb MCP", insurance.mcpServers);

  const investment = await resolveEffectiveRoleAssets("investment-researcher");
  assertCheck(investment.mcpServers.default.includes("wind_stock_data"), "investment-researcher has wind_stock_data MCP", investment.mcpServers);

  if (!args.skipHttp) {
    const adoptId = await chooseAuditAdoptId(args.adoptId);
    const audit = await postAuditSmoke(args, adoptId);
    assertCheck(audit.after > audit.before, "audit ingest increments MCP count", { adoptId, ...audit });
    const counts = await listMcpInvocationCounts(["wealth_assistant_customer"]);
    assertCheck(
      Number(counts.wealth_assistant_customer?.tools?.wealth_assistant_customer_list || 0) > 0,
      "MCP invocation aggregation sees smoke event",
      counts,
    );
  } else {
    pass("HTTP audit smoke skipped", { baseUrl: args.baseUrl });
  }

  const summary = { ok: true, checks };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const check of checks) console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
    console.log(`P7 role permissions smoke passed (${checks.length} checks)`);
  }
  process.exit(0);
}

main()
  .catch((error) => {
    const summary = { ok: false, error: error instanceof Error ? error.message : String(error), checks };
    if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 2));
    else {
      for (const check of checks) console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
      console.error(summary.error);
    }
    process.exit(1);
  });
