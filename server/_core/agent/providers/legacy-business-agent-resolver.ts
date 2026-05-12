import type { AgentDefinition, AgentProvider, AgentResult } from "../../../../shared/types/agent";
import { SecretHandle } from "../../../../shared/lib/secret-handle";
import type { ProviderResolvedBinding } from "./types";
import { getBusinessAgent } from "../../../db/agents";
import { resolveLegacyBusinessAgentSystemPrompt } from "./legacy-agent-prompts";

type LegacyBusinessAgentRow = {
  id: string;
  kind?: string | null;
  apiUrl?: string | null;
  apiToken?: string | null;
  remoteAgentId?: string | null;
  localAgentId?: string | null;
  enabled?: number | boolean | null;
  healthStatus?: string | null;
  allowedProfiles?: string | null;
  expiresAt?: Date | string | null;
  maxDailyRequests?: number | null;
  tags?: string | null;
  systemPrompt?: string | null;
};

type LegacyBusinessAgentLookup = (id: string) => Promise<LegacyBusinessAgentRow | undefined | null>;

function validationFailed(detail: string): AgentResult<ProviderResolvedBinding> {
  return { ok: false, error: { kind: "validation_failed", detail } };
}

function notFound(detail: string): AgentResult<ProviderResolvedBinding> {
  return { ok: false, error: { kind: "not_found", detail } };
}

function isEnabled(row: LegacyBusinessAgentRow): boolean {
  return row.enabled === true || row.enabled === 1;
}

function cleanMetadata(row: LegacyBusinessAgentRow, provider: AgentProvider): Record<string, unknown> {
  const transportKind = inferTransportKind(row.apiUrl || "");
  return {
    businessAgentId: row.id,
    legacyKind: row.kind || null,
    providerKey: provider.providerKey,
    healthStatus: row.healthStatus || null,
    allowedProfiles: row.allowedProfiles || null,
    expiresAt: row.expiresAt ? String(row.expiresAt) : null,
    maxDailyRequests: row.maxDailyRequests ?? null,
    tags: row.tags || null,
    adapterProtocol: inferAdapterProtocol(row, provider),
    transportKind,
  };
}

function resolveRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return process.env[ref] || ref;
}

function resolveEndpointRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (process.env[ref]) return process.env[ref];
  return /^https?:\/\//i.test(ref) ? ref : undefined;
}

function isManagedHermesProfile(definition: AgentDefinition): boolean {
  return definition.metadata?.managedHermesProfile === true;
}

function isLocalHermesEndpoint(apiUrl: string): boolean {
  try {
    const url = new URL(apiUrl);
    const port = Number(url.port);
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && Number.isFinite(port)
      && port >= 8600
      && port <= 8699;
  } catch {}
  return false;
}

function inferTransportKind(apiUrl: string): "direct" | "ssh-reverse-tunnel" {
  if (isLocalHermesEndpoint(apiUrl)) return "ssh-reverse-tunnel";
  return "direct";
}

function inferAdapterProtocol(row: LegacyBusinessAgentRow, provider: AgentProvider): string {
  if (row.id === "task-stock") return "stock-analysis-v1-agent-stream";
  if (provider.runtimeFamily === "claude-code") return "openai-chat-completions";
  if (provider.runtimeFamily !== "hermes") return "http-json";
  if (isLocalHermesEndpoint(row.apiUrl || "")) return "hermes-v1-runs";
  return "http-json";
}

export class LegacyBusinessAgentResolver {
  constructor(private readonly lookup: LegacyBusinessAgentLookup = getBusinessAgent) {}

  private resolveManagedHermesDefinition(
    definition: AgentDefinition,
    provider: AgentProvider,
  ): AgentResult<ProviderResolvedBinding> {
    if (provider.runtimeFamily !== "hermes") {
      return validationFailed(`managed Hermes profile requires hermes provider: ${definition.id}`);
    }

    const metadata = definition.metadata || {};
    const endpoint = resolveEndpointRef(definition.endpointRef)
      || (typeof metadata.defaultEndpoint === "string" ? metadata.defaultEndpoint : undefined);
    if (!endpoint) return validationFailed(`managed Hermes profile endpoint is missing: ${definition.id}`);

    const auth = resolveRef(definition.authRef)
      || process.env.HERMES_HTTP_KEY
      || process.env.LEGACY_HERMES_AUTH
      || process.env.LEGACY_BIZ_AGENT_TASK_HERMES_AUTH;

    const systemPrompt = typeof metadata.systemPrompt === "string" ? metadata.systemPrompt : undefined;
    const profileRef = definition.profileRef || definition.id;

    return {
      ok: true,
      value: {
        endpoint,
        auth: SecretHandle.of(auth),
        remoteAgentId: profileRef,
        localAgentId: profileRef,
        systemPrompt,
        healthStatus: definition.healthStatus,
        transport: { kind: inferTransportKind(endpoint) },
        metadata: {
          managedHermesProfile: true,
          providerKey: provider.providerKey,
          profileRef,
          agentRole: metadata.agentRole || null,
          agentTemplateId: metadata.agentTemplateId || null,
          adapterProtocol: "hermes-v1-runs",
          transportKind: inferTransportKind(endpoint),
        },
      },
    };
  }

  async resolve(definition: AgentDefinition, provider: AgentProvider): Promise<AgentResult<ProviderResolvedBinding>> {
    const row = await this.lookup(definition.id);
    if (!row) {
      if (isManagedHermesProfile(definition)) return this.resolveManagedHermesDefinition(definition, provider);
      return notFound(`legacy business agent not found: ${definition.id}`);
    }
    if (!isEnabled(row)) return notFound(`legacy business agent is disabled: ${definition.id}`);
    if (!row.apiUrl) return validationFailed(`legacy business agent endpoint is missing: ${definition.id}`);

    return {
      ok: true,
      value: {
        endpoint: row.apiUrl,
        auth: SecretHandle.of(row.apiToken),
        remoteAgentId: row.remoteAgentId || null,
        localAgentId: row.localAgentId || definition.profileRef || null,
        systemPrompt: resolveLegacyBusinessAgentSystemPrompt(row.id, row.systemPrompt),
        healthStatus: row.healthStatus || null,
        transport: { kind: inferTransportKind(row.apiUrl) },
        metadata: cleanMetadata(row, provider),
      },
    };
  }
}
