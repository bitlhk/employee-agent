import { z } from "zod";

/**
 * Lingxia agent registry and cluster contract.
 *
 * See docs/design/AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md for user-facing
 * capability semantics, provider/profile boundaries, artifact rules, and
 * cluster execution invariants. This file contains only shared runtime schemas
 * and Phase 1 stub interfaces; it must not import server routes, DB modules, or
 * UI code.
 */

export const AGENT_RUNTIME_FAMILIES = ["hermes", "claude-code", "openclaw", "hi-agent", "lingxia-local", "a2a"] as const;
export const agentRuntimeFamilySchema = z.enum(AGENT_RUNTIME_FAMILIES);
export type AgentRuntimeFamily = z.infer<typeof agentRuntimeFamilySchema>;

export const AGENT_PROTOCOLS = ["http-json", "sse", "websocket", "a2a"] as const;
export const agentProtocolSchema = z.enum(AGENT_PROTOCOLS);
export type AgentProtocol = z.infer<typeof agentProtocolSchema>;

export const AGENT_AUTH_TYPES = ["none", "bearer-token", "oauth", "internal-token"] as const;
export const agentAuthTypeSchema = z.enum(AGENT_AUTH_TYPES);
export type AgentAuthType = z.infer<typeof agentAuthTypeSchema>;

export const AGENT_HEALTH_STATUSES = ["unknown", "healthy", "degraded", "unhealthy", "offline"] as const;
export const agentHealthStatusSchema = z.enum(AGENT_HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof agentHealthStatusSchema>;

export const AGENT_VISIBILITY_SCOPES = ["platform-global", "space-scoped", "user-scoped", "subscription-scoped"] as const;
export const agentVisibilityScopeSchema = z.enum(AGENT_VISIBILITY_SCOPES);
export type AgentVisibilityScope = z.infer<typeof agentVisibilityScopeSchema>;

export const AGENT_CAPABILITY_CATEGORIES = [
  "finance-research",
  "insurance-risk",
  "office-productivity",
  "code-engineering",
  "general-assistant",
  "internal-tool",
  "custom",
] as const;
export const agentCapabilityCategorySchema = z.enum(AGENT_CAPABILITY_CATEGORIES);
export type AgentCapabilityCategory = z.infer<typeof agentCapabilityCategorySchema>;

export const AGENT_BRAND_FAMILIES = ["lingshu", "lingjiang", "lingxi", "custom"] as const;
export const agentBrandFamilySchema = z.enum(AGENT_BRAND_FAMILIES);
export type AgentBrandFamily = z.infer<typeof agentBrandFamilySchema>;

export const AGENT_PROVIDER_TRANSPORT_KINDS = ["direct", "ssh-reverse-tunnel", "frpc", "cloudflared"] as const;
export const agentProviderTransportKindSchema = z.enum(AGENT_PROVIDER_TRANSPORT_KINDS);
export type AgentProviderTransportKind = z.infer<typeof agentProviderTransportKindSchema>;

export const agentProviderTransportSchema = z.object({
  kind: agentProviderTransportKindSchema,
  upstreamRef: z.string().min(1).optional(),
  tunnelHealthCheckRef: z.string().min(1).optional(),
});
export type AgentProviderTransport = z.infer<typeof agentProviderTransportSchema>;

export const agentProviderSchema = z.object({
  id: z.string().min(1),
  providerKey: z.string().min(1),
  displayName: z.string().min(1),
  runtimeFamily: agentRuntimeFamilySchema,
  protocol: agentProtocolSchema,
  baseEndpointRef: z.string().min(1),
  transport: agentProviderTransportSchema.optional(),
  authType: agentAuthTypeSchema,
  authRef: z.string().min(1).optional(),
  healthCheckPath: z.string().min(1).optional(),
  enabled: z.boolean(),
  healthStatus: agentHealthStatusSchema,
  lastCheckedAt: z.string().min(1).optional(),
  lastError: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  updatedBy: z.number().int().positive().optional(),
});
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  agentKey: z.string().min(1),
  displayName: z.string().min(1),
  shortDescription: z.string().min(1),
  longDescription: z.string().optional(),
  capabilityCategory: agentCapabilityCategorySchema,
  providerId: z.string().min(1),
  profileRef: z.string().min(1).optional(),
  endpointRef: z.string().min(1).optional(),
  authRef: z.string().min(1).optional(),
  brandFamily: agentBrandFamilySchema.optional(),
  iconName: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  tagsJson: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean(),
  healthStatus: agentHealthStatusSchema,
  visibilityScope: agentVisibilityScopeSchema,
  visibilityConfigJson: z.object({
    spaceIds: z.array(z.number().int().positive()).optional(),
    userIds: z.array(z.number().int().positive()).optional(),
    profileKeys: z.array(z.string().min(1)).optional(),
  }).optional(),
  quotaConfig: z.object({
    dailyMax: z.number().int().nonnegative().optional(),
    expiresAt: z.string().min(1).nullable().optional(),
  }).optional(),
  systemPromptRef: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  updatedBy: z.number().int().positive().optional(),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const agentClusterExecutionModeSchema = z.enum(["parallel-append", "parallel", "sequential-2stage"]);
export type AgentClusterExecutionMode = z.infer<typeof agentClusterExecutionModeSchema>;

export const agentClusterSchema = z.object({
  id: z.string().min(1),
  userId: z.number().int().positive(),
  spaceId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  lastUsedAgentIdsJson: z.array(z.string().min(1)),
  lastInput: z.string().optional(),
  lastExecutionMode: agentClusterExecutionModeSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type AgentCluster = z.infer<typeof agentClusterSchema>;

export const agentArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["pptx", "html", "code", "markdown", "xlsx", "pdf", "image", "zip", "file"]),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  language: z.string().min(1).optional(),
  previewUrl: z.string().min(1).optional(),
  downloadUrl: z.string().min(1),
  workspacePath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((artifact, ctx) => {
  if (artifact.type === "code" && !artifact.language) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["language"],
      message: "language is required when artifact type is code",
    });
  }
});
export type AgentArtifact = z.infer<typeof agentArtifactSchema>;

export const agentRunResultSchema = z.object({
  id: z.string().min(1),
  envelopeVersion: z.literal("v1"),
  agentDefinitionId: z.string().min(1),
  clusterRunId: z.string().min(1).optional(),
  status: z.enum(["success", "failed"]),
  summary: z.string().optional(),
  output: z.string().optional(),
  artifacts: z.array(agentArtifactSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string().min(1), detail: z.string().min(1) }).optional(),
  producedAt: z.string().min(1),
}).superRefine((result, ctx) => {
  if (result.status === "failed" && !result.error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["error"],
      message: "error is required when status is failed",
    });
  }
});
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;

export const agentSummaryArtifactSchema = z.object({
  envelopeVersion: z.literal("v1"),
  kind: z.literal("summary"),
  clusterRunId: z.string().min(1),
  summarizerDefinitionId: z.literal("lingxia-summarizer"),
  summary: z.string().min(1),
  citations: z.array(z.object({
    agentDefinitionId: z.string().min(1),
    runResultId: z.string().min(1),
    excerpt: z.string().min(1),
  })).min(1),
  producedAt: z.string().min(1),
});
export type AgentSummaryArtifact = z.infer<typeof agentSummaryArtifactSchema>;

export const agentClusterRunSchema = z.object({
  id: z.string().min(1),
  clusterId: z.string().min(1).nullable().optional(),
  userId: z.number().int().positive(),
  spaceId: z.number().int().positive().nullable().optional(),
  input: z.string(),
  selectedAgentIdsJson: z.array(z.string().min(1)),
  status: z.enum(["running", "completed", "partial_success", "failed", "cancelled", "timeout"]),
  resultsJson: z.array(agentRunResultSchema),
  runtimeSnapshotJson: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  inputBytes: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  errorSummary: z.string().optional(),
  createdAt: z.string().min(1),
});
export type AgentClusterRun = z.infer<typeof agentClusterRunSchema>;

export const agentCallContextSchema = z.object({
  adoptId: z.string().min(1),
  userId: z.number().int().positive(),
  spaceId: z.number().int().positive().nullable().optional(),
  agentId: z.string().min(1),
  profileRef: z.string().min(1).optional(),
  clusterRunId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type AgentCallContext = z.infer<typeof agentCallContextSchema>;

export const createClusterInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  agentDefinitionIds: z.array(z.string().min(1)).min(1),
  input: z.string().optional(),
});
export type CreateClusterInput = z.infer<typeof createClusterInputSchema>;

export const runClusterInputSchema = z.object({
  agentDefinitionIds: z.array(z.string().min(1)).min(1).optional(),
  input: z.string().min(1),
  executionMode: agentClusterExecutionModeSchema.optional(),
});
export type RunClusterInput = z.infer<typeof runClusterInputSchema>;

export const agentClusterPlanSchema = z.object({
  suggestions: z.array(z.object({
    agentDefinitionId: z.string().min(1),
    reason: z.string().min(1),
  })),
  executionMode: z.enum(["parallel", "sequential-2stage"]),
  requiresUserConfirmation: z.literal(true),
});
export type AgentClusterPlan = z.infer<typeof agentClusterPlanSchema>;

export type AgentRegistryError =
  | { kind: "not_found"; detail: string }
  | { kind: "validation_failed"; detail: string }
  | { kind: "unauthorized"; detail: string }
  | { kind: "provider_unhealthy"; detail: string }
  | { kind: "dispatch_failed"; detail: string }
  | { kind: "not_implemented"; detail: string };

export type AgentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentRegistryError };

export interface AgentRegistry {
  listProviders(): Promise<AgentResult<AgentProvider[]>>;
  listDefinitions(viewerUserId: number): Promise<AgentResult<AgentDefinition[]>>;
  getDefinition(definitionId: string): Promise<AgentResult<AgentDefinition>>;
  setEnabled(definitionId: string, enabled: boolean, actorUserId: number): Promise<AgentResult<AgentDefinition>>;
  dispatchToDefinition(definitionId: string, input: string, context: AgentCallContext): Promise<AgentResult<AgentRunResult>>;
  healthCheck(target: { providerId?: string; definitionId?: string }): Promise<AgentResult<HealthStatus>>;
}

export interface AgentClusterRunner {
  createCluster(userId: number, input: CreateClusterInput): Promise<AgentResult<AgentCluster>>;
  loadLastUsed(userId: number, spaceId?: number | null): Promise<AgentResult<AgentCluster | null>>;
  runCluster(clusterId: string | null, input: RunClusterInput): Promise<AgentResult<{ runId: string }>>;
  getRunResult(runId: string): Promise<AgentResult<AgentClusterRun>>;
}
