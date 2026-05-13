import type {
  AgentCluster,
  AgentClusterRun,
  AgentClusterRunner,
  AgentDefinition,
  AgentProvider,
  AgentRegistry,
  AgentResult,
  CreateClusterInput,
  RunClusterInput,
} from "../../../shared/types/agent";
import type { ProviderAdapterFactory, ProviderStreamEvent } from "./providers/types";
import type { ProviderBindingResolver, ProviderResolvedBinding } from "./providers/types";

function notImplemented<T>(method: string): AgentResult<T> {
  return {
    ok: false,
    error: {
      kind: "not_implemented",
      detail: `AgentClusterRunner.${method} not implemented in Phase 1`,
    },
  };
}

export class StubAgentClusterRunner implements AgentClusterRunner {
  async createCluster(_userId: number, _input: CreateClusterInput): Promise<AgentResult<AgentCluster>> {
    return notImplemented("createCluster");
  }

  async loadLastUsed(_userId: number, _spaceId?: number | null): Promise<AgentResult<AgentCluster | null>> {
    return notImplemented("loadLastUsed");
  }

  async runCluster(_clusterId: string | null, _input: RunClusterInput): Promise<AgentResult<{ runId: string }>> {
    return notImplemented("runCluster");
  }

  async getRunResult(_runId: string): Promise<AgentResult<AgentClusterRun>> {
    return notImplemented("getRunResult");
  }
}

export class AdapterAgentClusterRunner implements AgentClusterRunner {
  private readonly runs = new Map<string, AgentClusterRun>();

  constructor(
    private readonly options: {
      registry: AgentRegistry;
      createAdapter: ProviderAdapterFactory;
      resolveBinding?: ProviderBindingResolver;
      onProviderEvent?: (event: ProviderStreamEvent & { agentDefinitionId: string }) => void;
      userId: number;
      spaceId?: number | null;
      maxAgents?: number;
    },
  ) {}

  async createCluster(_userId: number, _input: CreateClusterInput): Promise<AgentResult<AgentCluster>> {
    return notImplemented("createCluster");
  }

  async loadLastUsed(_userId: number, _spaceId?: number | null): Promise<AgentResult<AgentCluster | null>> {
    return notImplemented("loadLastUsed");
  }

  async runCluster(_clusterId: string | null, input: RunClusterInput): Promise<AgentResult<{ runId: string }>> {
    const selectedIds = input.agentDefinitionIds || [];
    if (selectedIds.length === 0) {
      return { ok: false, error: { kind: "validation_failed", detail: "agentDefinitionIds is required" } };
    }
    const maxAgents = this.options.maxAgents || 3;
    if (selectedIds.length > maxAgents) {
      return { ok: false, error: { kind: "validation_failed", detail: `too many agents selected: max ${maxAgents}` } };
    }

    const providersResult = await this.options.registry.listProviders();
    if (!providersResult.ok) return providersResult as AgentResult<{ runId: string }>;
    const visibleResult = await this.options.registry.listDefinitions(this.options.userId);
    if (!visibleResult.ok) return visibleResult as AgentResult<{ runId: string }>;

    const visibleById = new Map<string, AgentDefinition>(visibleResult.value.map((definition) => [definition.id, definition]));
    const providerById = new Map<string, AgentProvider>(providersResult.value.map((provider) => [provider.id, provider]));
    for (const selectedId of selectedIds) {
      if (!visibleById.has(selectedId)) {
        return { ok: false, error: { kind: "unauthorized", detail: `agent is not visible or dispatchable: ${selectedId}` } };
      }
    }

    const runId = `acl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const resolvedById = new Map<string, ProviderResolvedBinding>();
    const results = await Promise.all(selectedIds.map(async (definitionId) => {
      const definition = visibleById.get(definitionId)!;
      const provider = providerById.get(definition.providerId);
      if (!provider) {
        return {
          id: `${definitionId}-${runId}`,
          envelopeVersion: "v1" as const,
          agentDefinitionId: definitionId,
          clusterRunId: runId,
          status: "failed" as const,
          artifacts: [],
          error: { code: "provider_missing", detail: `provider missing: ${definition.providerId}` },
          producedAt: new Date().toISOString(),
        };
      }
      const adapter = this.options.createAdapter(provider);
      if (!adapter) {
        return {
          id: `${definitionId}-${runId}`,
          envelopeVersion: "v1" as const,
          agentDefinitionId: definitionId,
          clusterRunId: runId,
          status: "failed" as const,
          artifacts: [],
          error: { code: "adapter_missing", detail: `adapter missing for provider: ${provider.providerKey}` },
          producedAt: new Date().toISOString(),
        };
      }
      let resolved: ProviderResolvedBinding | undefined;
      if (this.options.resolveBinding) {
        const resolvedResult = await this.options.resolveBinding({ definition, provider });
        if (!resolvedResult.ok) {
          return {
            id: `${definitionId}-${runId}`,
            envelopeVersion: "v1" as const,
            agentDefinitionId: definitionId,
            clusterRunId: runId,
            status: "failed" as const,
            artifacts: [],
            error: { code: resolvedResult.error.kind, detail: resolvedResult.error.detail },
            producedAt: new Date().toISOString(),
          };
        }
        resolved = resolvedResult.value;
        resolvedById.set(definitionId, resolved);
      }
      const dispatched = await adapter.dispatch({
        definition,
        provider,
        resolved,
        prompt: input.input,
        context: {
          adoptId: "agent-cluster-lab",
          userId: this.options.userId,
          spaceId: this.options.spaceId,
          agentId: definition.id,
          profileRef: definition.profileRef,
          clusterRunId: runId,
          timeoutMs: input.executionMode ? undefined : definition.timeoutMs || provider.timeoutMs,
        },
        onEvent: (event) => this.options.onProviderEvent?.({ ...event, agentDefinitionId: definition.id }),
      });
      if (!dispatched.ok) {
        return {
          id: `${definitionId}-${runId}`,
          envelopeVersion: "v1" as const,
          agentDefinitionId: definitionId,
          clusterRunId: runId,
          status: "failed" as const,
          artifacts: [],
          error: { code: dispatched.error.kind, detail: dispatched.error.detail },
          producedAt: new Date().toISOString(),
        };
      }
      return { ...dispatched.value, clusterRunId: runId };
    }));

    const failedCount = results.filter((result) => result.status === "failed").length;
    const status: AgentClusterRun["status"] = failedCount === 0
      ? "completed"
      : failedCount === results.length ? "failed" : "partial_success";
    this.runs.set(runId, {
      id: runId,
      clusterId: _clusterId,
      userId: this.options.userId,
      spaceId: this.options.spaceId,
      input: input.input,
      selectedAgentIdsJson: selectedIds,
      status,
      resultsJson: results,
      runtimeSnapshotJson: {
        selected: selectedIds.map((id) => {
          const definition = visibleById.get(id);
          const provider = definition ? providerById.get(definition.providerId) : undefined;
          const resolved = resolvedById.get(id);
          const transportKind = resolved?.transport?.kind || provider?.transport?.kind || "direct";
          return {
            agentDefinitionId: id,
            providerKey: provider?.providerKey,
            runtimeFamily: provider?.runtimeFamily,
            healthStatus: definition?.healthStatus,
            providerHealthStatus: provider?.healthStatus,
            transportKind,
            transport: {
              kind: transportKind,
            },
          };
        }),
      },
      startedAt,
      completedAt: new Date().toISOString(),
      inputBytes: Buffer.byteLength(input.input, "utf8"),
      outputBytes: results.reduce((sum, result) => sum + Buffer.byteLength(result.output || result.summary || "", "utf8"), 0),
      errorSummary: failedCount ? `${failedCount}/${results.length} agents failed` : undefined,
      createdAt: startedAt,
    });
    return { ok: true, value: { runId } };
  }

  async getRunResult(runId: string): Promise<AgentResult<AgentClusterRun>> {
    const run = this.runs.get(runId);
    if (!run) return { ok: false, error: { kind: "not_found", detail: `cluster run not found: ${runId}` } };
    return { ok: true, value: run };
  }
}

export const agentClusterRunner: AgentClusterRunner = new StubAgentClusterRunner();
