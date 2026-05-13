import type {
  AgentCallContext,
  AgentDefinition,
  AgentProvider,
  AgentRegistry,
  AgentResult,
  AgentRunResult,
  HealthStatus,
} from "../../../shared/types/agent";
import {
  agentDefinitionSchema,
  agentProviderSchema,
} from "../../../shared/types/agent";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

function notImplemented<T>(method: string): AgentResult<T> {
  return {
    ok: false,
    error: {
      kind: "not_implemented",
      detail: `AgentRegistry.${method} not implemented in Phase 1`,
    },
  };
}

const agentRegistrySeedSchema = z.object({
  providers: z.array(agentProviderSchema),
  definitions: z.array(agentDefinitionSchema),
});

type AgentRegistrySeed = z.infer<typeof agentRegistrySeedSchema>;
type ViewerContext = { spaceId: number | null };

const DEFAULT_SEED_PATH = path.join(process.cwd(), "server/_core/agent/data/agents.seed.json");

function validationFailed<T>(detail: string): AgentResult<T> {
  return { ok: false, error: { kind: "validation_failed", detail } };
}

function isDispatchableHealth(status: HealthStatus): boolean {
  return status === "healthy" || status === "unknown";
}

function isDefinitionEnabled(definition: AgentDefinition, provider: AgentProvider | undefined): boolean {
  if (!provider) return false;
  return definition.enabled && provider.enabled && isDispatchableHealth(definition.healthStatus) && isDispatchableHealth(provider.healthStatus);
}

function isVisibleToViewer(definition: AgentDefinition, viewerUserId: number, viewerContext: ViewerContext | null): boolean {
  if (definition.visibilityScope === "platform-global") return true;

  if (definition.visibilityScope === "user-scoped") {
    return Boolean(definition.visibilityConfigJson?.userIds?.includes(viewerUserId));
  }

  if (definition.visibilityScope === "space-scoped") {
    const viewerSpaceId = viewerContext?.spaceId;
    if (!viewerSpaceId) return false;
    return Boolean(definition.visibilityConfigJson?.spaceIds?.includes(viewerSpaceId));
  }

  if (definition.visibilityScope === "subscription-scoped") {
    // Phase 2 registry reads do not yet have subscription/profile context.
    // Deny by default until Phase 3 wires the real profile source.
    return false;
  }

  return false;
}

export class JsonAgentRegistry implements AgentRegistry {
  constructor(
    private readonly options: {
      seedPath?: string;
      resolveViewerContext?: (viewerUserId: number) => Promise<ViewerContext | null>;
    } = {},
  ) {}

  private async readSeed(): Promise<AgentResult<AgentRegistrySeed>> {
    const seedPath = this.options.seedPath || DEFAULT_SEED_PATH;
    let raw: string;
    try {
      raw = await fs.readFile(seedPath, "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return { ok: true, value: { providers: [], definitions: [] } };
      }
      return validationFailed(`failed to read agent seed file: ${error?.message || String(error)}`);
    }

    try {
      const json = JSON.parse(raw);
      return { ok: true, value: agentRegistrySeedSchema.parse(json) };
    } catch (error: any) {
      return validationFailed(`invalid agent seed file: ${error?.message || String(error)}`);
    }
  }

  async listProviders(): Promise<AgentResult<AgentProvider[]>> {
    const seed = await this.readSeed();
    if (!seed.ok) return seed;
    return { ok: true, value: seed.value.providers };
  }

  async listDefinitions(viewerUserId: number): Promise<AgentResult<AgentDefinition[]>> {
    const seed = await this.readSeed();
    if (!seed.ok) return seed;

    const providerById = new Map(seed.value.providers.map((provider) => [provider.id, provider]));
    const viewerContext = this.options.resolveViewerContext ? await this.options.resolveViewerContext(viewerUserId) : null;
    const definitions = seed.value.definitions
      .filter((definition) => isDefinitionEnabled(definition, providerById.get(definition.providerId)))
      .filter((definition) => isVisibleToViewer(definition, viewerUserId, viewerContext))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.displayName.localeCompare(b.displayName));

    return { ok: true, value: definitions };
  }

  async getDefinition(definitionId: string): Promise<AgentResult<AgentDefinition>> {
    const seed = await this.readSeed();
    if (!seed.ok) return seed as AgentResult<AgentDefinition>;
    const definition = seed.value.definitions.find((item) => item.id === definitionId);
    if (!definition) {
      return { ok: false, error: { kind: "not_found", detail: `agent definition not found: ${definitionId}` } };
    }
    return { ok: true, value: definition };
  }

  async setEnabled(_definitionId: string, _enabled: boolean, _actorUserId: number): Promise<AgentResult<AgentDefinition>> {
    return notImplemented("setEnabled");
  }

  async dispatchToDefinition(_definitionId: string, _input: string, _context: AgentCallContext): Promise<AgentResult<AgentRunResult>> {
    return notImplemented("dispatchToDefinition");
  }

  async healthCheck(_target: { providerId?: string; definitionId?: string }): Promise<AgentResult<HealthStatus>> {
    return notImplemented("healthCheck");
  }
}

export const agentRegistry: AgentRegistry = new JsonAgentRegistry();
