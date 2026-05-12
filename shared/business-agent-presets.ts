export const RESERVED_LEGACY_BUSINESS_AGENT_IDS = [
  "task-stock",
  "task-bond",
  "task-credit-risk",
  "task-claim-ev",
  "task-my-wealth",
  "task-hermes",
  "task-trace",
  "task-ppt",
  "task-code",
  "task-slides",
] as const;

export const BUILTIN_BUSINESS_AGENT_ADAPTERS = [
  "stock-agent-v1",
  "my-wealth-hermes-v1",
  "bond-hermes-v1",
  "credit-risk-hermes-v1",
  "claim-ev-hermes-v1",
] as const;

const reservedLegacyIds = new Set<string>(RESERVED_LEGACY_BUSINESS_AGENT_IDS);
const builtinAdapters = new Set<string>(BUILTIN_BUSINESS_AGENT_ADAPTERS);

export function isReservedLegacyBusinessAgentId(id: string | null | undefined): boolean {
  return reservedLegacyIds.has(String(id || "").trim());
}

export function isBuiltinBusinessAgentAdapter(adapterProtocol: string | null | undefined): boolean {
  return builtinAdapters.has(String(adapterProtocol || "").trim());
}
