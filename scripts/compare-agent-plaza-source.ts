import { JsonAgentRegistry } from "../server/_core/agent/agent-registry";

const baseUrl = process.env.LINGXIA_INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5180"}`;
const expectedLiveSource = process.env.AGENT_PLAZA_EXPECT_LIVE_SOURCE || "legacy";
const expectedCount = Number(process.env.AGENT_PLAZA_EXPECT_COUNT || 10);
const internalLeakPattern = /migrationNote|runtime-inferred|manual-review|verify before dispatch|manual_review/i;

type AgentSnapshot = {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: string;
  sandboxScope?: string;
  remote?: boolean;
  healthStatus?: string;
};

function normalizeLegacyAgent(agent: any): AgentSnapshot {
  return {
    id: String(agent.id || ""),
    name: String(agent.name || ""),
    description: String(agent.description || ""),
    icon: String(agent.icon || ""),
    kind: String(agent.kind || ""),
    sandboxScope: agent.sandboxScope ? String(agent.sandboxScope) : undefined,
    remote: typeof agent.remote === "boolean" ? agent.remote : undefined,
    healthStatus: agent.healthStatus ? String(agent.healthStatus) : undefined,
  };
}

function registryAgentToLegacyShape(agent: any): AgentSnapshot {
  const metadata = agent.metadata || {};
  const legacyKind = String(metadata.legacyKind || "").toLowerCase();
  const kind = legacyKind === "local" || legacyKind === "remote"
    ? legacyKind
    : String(agent.providerId || "").includes("lingxia-local") || String(agent.providerId || "").includes("openclaw") ? "local" : "remote";
  return {
    id: agent.id,
    name: agent.displayName,
    description: agent.longDescription || agent.shortDescription || "",
    icon: String(metadata.legacyIcon || agent.iconName || "Bot"),
    kind,
    sandboxScope: kind === "local" ? "agent" : "remote",
    remote: kind !== "local",
    healthStatus: agent.healthStatus,
  };
}

function normalizeList(list: AgentSnapshot[]) {
  return list
    .map((item) => ({
      id: item.id,
      name: item.name,
      descriptionFirstLine: item.description.split("\n")[0],
      icon: item.icon,
      kind: item.kind,
      sandboxScope: item.sandboxScope || "",
      remote: item.remote ?? null,
      healthStatus: item.healthStatus || "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function compare(legacy: ReturnType<typeof normalizeList>, registry: ReturnType<typeof normalizeList>) {
  const ids = [...new Set([...legacy.map((x) => x.id), ...registry.map((x) => x.id)])].sort();
  const diffs: string[] = [];
  const legacyById = new Map(legacy.map((item) => [item.id, item]));
  const registryById = new Map(registry.map((item) => [item.id, item]));
  for (const id of ids) {
    const left = legacyById.get(id);
    const right = registryById.get(id);
    if (!left || !right) {
      diffs.push(`${id}: ${left ? "missing in registry" : "missing in legacy"}`);
      continue;
    }
    for (const key of ["name", "descriptionFirstLine", "icon", "kind", "sandboxScope", "remote"] as const) {
      if (left[key] !== right[key]) {
        diffs.push(`${id}.${key}: legacy=${JSON.stringify(left[key])} registry=${JSON.stringify(right[key])}`);
      }
    }
  }
  return diffs;
}

function findInternalLeaks(label: string, value: unknown): string[] {
  const leaks: string[] = [];
  const walk = (path: string, node: unknown) => {
    if (typeof node === "string") {
      if (internalLeakPattern.test(node)) leaks.push(`${label}${path}: ${JSON.stringify(node)}`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(`${path}[${index}]`, item));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        walk(`${path}.${key}`, item);
      }
    }
  };
  walk("", value);
  return leaks;
}

const legacyResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/api/claw/business-agents`);
if (!legacyResponse.ok) {
  throw new Error(`legacy endpoint failed: HTTP ${legacyResponse.status}`);
}
const legacyPayload: any = await legacyResponse.json();
const liveSource = String(legacyPayload.source || "unknown");
const legacy = normalizeList((legacyPayload.agents || []).map(normalizeLegacyAgent));

const registry = new JsonAgentRegistry();
const definitions = await registry.listDefinitions(0);
if (!definitions.ok) {
  throw new Error(`registry list failed: ${definitions.error.kind}: ${definitions.error.detail}`);
}
const registryList = normalizeList(definitions.value.map(registryAgentToLegacyShape));
const diffs = compare(legacy, registryList);
const leaks = [
  ...findInternalLeaks("live", legacyPayload),
  ...findInternalLeaks("registry-adapter", definitions.value.map(registryAgentToLegacyShape)),
];

console.log(`[AGENT-PLAZA-COMPARE] legacy count=${legacy.length}`);
console.log(`[AGENT-PLAZA-COMPARE] registry count=${registryList.length}`);
console.log(`[AGENT-PLAZA-COMPARE] live source=${liveSource}`);

const failures: string[] = [];
if (liveSource !== expectedLiveSource) {
  failures.push(`live source expected ${expectedLiveSource}, got ${liveSource}`);
}
if (legacy.length !== expectedCount) {
  failures.push(`legacy count expected ${expectedCount}, got ${legacy.length}`);
}
if (registryList.length !== expectedCount) {
  failures.push(`registry count expected ${expectedCount}, got ${registryList.length}`);
}
for (const diff of diffs) failures.push(`diff: ${diff}`);
for (const leak of leaks) failures.push(`internal metadata leaked: ${leak}`);

if (failures.length === 0) {
  console.log("[AGENT-PLAZA-COMPARE] PASS: normalized legacy and registry lists match");
} else {
  console.error(`[AGENT-PLAZA-COMPARE] FAIL count=${failures.length}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}
