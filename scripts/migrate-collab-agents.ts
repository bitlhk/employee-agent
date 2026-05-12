import { COLLAB_AGENTS } from "../client/src/lib/collabAgents";
import type { AgentCapabilityCategory, AgentDefinition, AgentProvider, AgentRuntimeFamily } from "../shared/types/agent";
import { agentDefinitionSchema, agentProviderSchema } from "../shared/types/agent";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEED_PATH = path.join(ROOT, "server/_core/agent/data/agents.seed.json");
const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");

type LegacyBizAgent = {
  id: string;
  name: string;
  description?: string | null;
  kind?: "local" | "remote";
  icon?: string | null;
  enabled?: number | boolean | null;
  sortOrder?: number | null;
  remoteAgentId?: string | null;
  localAgentId?: string | null;
  tags?: string | null;
};

type LegacySource = "business_agents_db" | "collabAgents_ts_fallback";

type InferredMapping = {
  providerKey: string;
  runtimeFamily: AgentRuntimeFamily;
  capabilityCategory: AgentCapabilityCategory;
  iconName: string;
  tags: string[];
  inferredReason: string;
  manualReview?: string;
};

const PROVIDER_DISPLAY: Record<string, string> = {
  "legacy-claude-code": "Legacy Claude Code Agents",
  "legacy-hermes": "Legacy Hermes Agents",
  "legacy-lingxia-local": "Legacy Lingxia Local Agents",
};

function legacyEnvKey(id: string, suffix: string): string {
  return `LEGACY_BIZ_AGENT_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

function inferMapping(id: string): InferredMapping {
  if (id === "task-slides" || id === "task-ppt" || id === "task-code") {
    return {
      providerKey: "legacy-claude-code",
      runtimeFamily: "claude-code",
      capabilityCategory: id === "task-code" ? "code-engineering" : "office-productivity",
      iconName: id === "task-code" ? "Code2" : "Presentation",
      tags: ["legacy-business-agent", "creation"],
      inferredReason: `${id} mapped to claude-code by legacy id convention; verify before dispatch wiring`,
    };
  }

  if (id === "task-stock") {
    return {
      providerKey: "legacy-lingxia-local",
      runtimeFamily: "lingxia-local",
      capabilityCategory: "finance-research",
      iconName: "TrendingUp",
      tags: ["legacy-business-agent", "finance", "manual-review"],
      inferredReason: "task-stock runtime is inferred from legacy id; deployment shape is explicitly unknown",
      manualReview: "task-stock deployment shape should be verified before Phase 3 dispatch wiring",
    };
  }

  if (id === "task-claim-ev") {
    return {
      providerKey: "legacy-hermes",
      runtimeFamily: "hermes",
      capabilityCategory: "insurance-risk",
      iconName: "ShieldCheck",
      tags: ["legacy-business-agent", "insurance"],
      inferredReason: "task-claim-ev mapped to hermes by legacy financial-agent convention; verify before dispatch wiring",
    };
  }

  if (id === "task-hermes" || id === "task-trace") {
    return {
      providerKey: "legacy-hermes",
      runtimeFamily: "hermes",
      capabilityCategory: "general-assistant",
      iconName: id === "task-trace" ? "Search" : "Brain",
      tags: ["legacy-business-agent", "core"],
      inferredReason: `${id} mapped to hermes by legacy core-agent convention; verify before dispatch wiring`,
    };
  }

  if (id === "task-my-wealth" || id === "task-bond" || id === "task-credit-risk") {
    return {
      providerKey: "legacy-hermes",
      runtimeFamily: "hermes",
      capabilityCategory: "finance-research",
      iconName: id === "task-credit-risk" ? "Landmark" : "LineChart",
      tags: ["legacy-business-agent", "finance"],
      inferredReason: `${id} mapped to hermes by legacy financial-agent convention; verify before dispatch wiring`,
    };
  }

  return {
    providerKey: "legacy-hermes",
    runtimeFamily: "hermes",
    capabilityCategory: "general-assistant",
    iconName: "Bot",
    tags: ["legacy-business-agent", "manual-review"],
    inferredReason: `runtime family inferred from legacy id ${id}; verify before dispatch wiring`,
    manualReview: `runtime family inferred from legacy id ${id}; verify before dispatch wiring`,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function loadLegacyAgents(): Promise<{ source: LegacySource; agents: LegacyBizAgent[] }> {
  try {
    const baseUrl = process.env.LINGXIA_INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5180"}`;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/claw/business-agents`, {
      headers: { "x-smoke-source": "agent-migrate" },
    });
    if (response.ok) {
      const payload: any = await response.json();
      if (Array.isArray(payload?.agents) && payload.agents.length > 0) {
        return { source: "business_agents_db", agents: payload.agents as LegacyBizAgent[] };
      }
    }
  } catch (error: any) {
    console.warn(`[AGENT-MIGRATE] failed to read /api/claw/business-agents; fallback to collabAgents.ts: ${error?.message || String(error)}`);
  }

  return {
    source: "collabAgents_ts_fallback",
    agents: COLLAB_AGENTS.map((agent, index) => ({
      id: agent.id,
      name: agent.name,
      description: `Legacy match rule: /${agent.pattern.source}/${agent.pattern.flags}`,
      kind: "remote",
      icon: agent.emoji,
      enabled: 1,
      sortOrder: index,
      remoteAgentId: agent.id,
    })),
  };
}

function buildSeed(source: LegacySource, legacyAgents: LegacyBizAgent[]) {
  const now = nowIso();
  const corrupted: string[] = [];
  const manualReview: string[] = [];
  const providerByKey = new Map<string, AgentProvider>();
  const definitions: AgentDefinition[] = [];

  for (const agent of legacyAgents) {
    if (!agent.id || !agent.name) {
      corrupted.push(JSON.stringify(agent));
      continue;
    }

    const inferred = inferMapping(agent.id);
    if (inferred.manualReview) {
      manualReview.push(`${agent.id}: ${inferred.manualReview}`);
    }

    if (!providerByKey.has(inferred.providerKey)) {
      const provider: AgentProvider = {
        id: inferred.providerKey,
        providerKey: inferred.providerKey,
        displayName: PROVIDER_DISPLAY[inferred.providerKey] || inferred.providerKey,
        runtimeFamily: inferred.runtimeFamily,
        protocol: "http-json",
        baseEndpointRef: `${inferred.providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_BASE_ENDPOINT`,
        authType: "internal-token",
        authRef: `${inferred.providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_AUTH`,
        enabled: true,
        healthStatus: "unknown",
        timeoutMs: 300000,
        retryCount: 1,
        createdAt: now,
        updatedAt: now,
      };
      providerByKey.set(inferred.providerKey, agentProviderSchema.parse(provider));
    }

    const definition: AgentDefinition = {
      id: agent.id,
      agentKey: agent.id,
      displayName: agent.name,
      shortDescription: (agent.description || `Legacy business agent migrated from ${source}`).split("\n")[0].slice(0, 240),
      capabilityCategory: inferred.capabilityCategory,
      providerId: inferred.providerKey,
      profileRef: agent.remoteAgentId || agent.localAgentId || agent.id,
      endpointRef: legacyEnvKey(agent.id, "ENDPOINT"),
      authRef: legacyEnvKey(agent.id, "AUTH"),
      iconName: inferred.iconName,
      sortOrder: Number(agent.sortOrder ?? definitions.length),
      tagsJson: [...new Set([...inferred.tags, "runtime-inferred", source])],
      enabled: agent.enabled === false || agent.enabled === 0 ? false : true,
      healthStatus: "unknown",
      visibilityScope: "platform-global",
      visibilityConfigJson: {},
      timeoutMs: 300000,
      retryCount: 1,
      createdAt: now,
      updatedAt: now,
      // Runtime mapping is inferred from legacy agent ids/names because the
      // current /api/claw/business-agents shape does not expose provider truth.
      // Phase 4 dispatch must verify endpoint/provider mapping before calling.
      // Keep the reason in longDescription so seed readers see it without
      // adding schema-only fields.
      metadata: {
        migrationNote: inferred.inferredReason,
        migratedFrom: source,
        legacyIcon: agent.icon || "",
        legacyKind: agent.kind || "remote",
      },
    };
    definitions.push(agentDefinitionSchema.parse(definition));
  }

  definitions.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.displayName.localeCompare(b.displayName));

  return {
    seed: {
      providers: [...providerByKey.values()].sort((a, b) => a.id.localeCompare(b.id)),
      definitions,
    },
    corrupted,
    manualReview,
  };
}

function printReport(source: LegacySource, seed: { providers: AgentProvider[]; definitions: AgentDefinition[] }, corrupted: string[], manualReview: string[]) {
  console.log(`[AGENT-MIGRATE] mode=${shouldApply ? "apply" : "dry-run"}`);
  console.log(`[AGENT-MIGRATE] source=${source}`);
  console.log(`[AGENT-MIGRATE] legacy agents scanned: ${seed.definitions.length + corrupted.length}`);
  console.log(`[AGENT-MIGRATE] providers generated: ${seed.providers.length}`);
  for (const provider of seed.providers) {
    console.log(`  - provider ${provider.id}: runtime=${provider.runtimeFamily}, health=${provider.healthStatus}`);
  }
  console.log(`[AGENT-MIGRATE] definitions generated: ${seed.definitions.length}`);
  for (const definition of seed.definitions) {
    console.log(`  - ${definition.id}: provider=${definition.providerId}, category=${definition.capabilityCategory}, visibility=${definition.visibilityScope}, health=${definition.healthStatus}, enabled=${definition.enabled}`);
  }
  console.log(`[AGENT-MIGRATE] manual review: ${manualReview.length}`);
  for (const item of manualReview) {
    console.log(`  - ${item}`);
  }
  console.log(`[AGENT-MIGRATE] corrupted rows skipped: ${corrupted.length}`);
  for (const item of corrupted) {
    console.log(`  - ${item}`);
  }
}

function applySeed(seed: { providers: AgentProvider[]; definitions: AgentDefinition[] }) {
  mkdirSync(path.dirname(SEED_PATH), { recursive: true });
  if (existsSync(SEED_PATH)) {
    const backupPath = `${SEED_PATH}.bak-${Date.now()}`;
    copyFileSync(SEED_PATH, backupPath);
    console.log(`[AGENT-MIGRATE] backup written: ${backupPath}`);
  }
  writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  console.log(`[AGENT-MIGRATE] seed written: ${SEED_PATH}`);
}

const { source, agents } = await loadLegacyAgents();
const { seed, corrupted, manualReview } = buildSeed(source, agents);
printReport(source, seed, corrupted, manualReview);

if (shouldApply) {
  applySeed(seed);
} else {
  console.log("[AGENT-MIGRATE] dry-run only; pass --apply to write seed file");
}
