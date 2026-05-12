import { describe, expect, it } from "vitest";
import {
  agentArtifactSchema,
  agentClusterPlanSchema,
  agentClusterRunSchema,
  agentDefinitionSchema,
  agentProviderSchema,
  agentRunResultSchema,
  agentSummaryArtifactSchema,
  type AgentRunResult,
} from "../../../../shared/types/agent";

const baseArtifact = {
  id: "artifact-1",
  type: "markdown",
  name: "result.md",
  downloadUrl: "/api/files/signed/result",
} as const;

const baseEnvelope: AgentRunResult = {
  id: "result-1",
  envelopeVersion: "v1",
  agentDefinitionId: "stock-analysis",
  clusterRunId: "run-1",
  status: "success",
  summary: "OK",
  output: "OK",
  artifacts: [baseArtifact],
  producedAt: "2026-05-03T00:00:00.000Z",
};

describe("agent shared schemas", () => {
  it("accepts a complete valid envelope", () => {
    expect(agentRunResultSchema.safeParse(baseEnvelope).success).toBe(true);
  });

  it("rejects an envelope missing envelopeVersion", () => {
    const { envelopeVersion, ...value } = baseEnvelope;
    expect(agentRunResultSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an envelope missing agentDefinitionId", () => {
    const { agentDefinitionId, ...value } = baseEnvelope;
    expect(agentRunResultSchema.safeParse(value).success).toBe(false);
  });

  it("requires error when envelope status is failed", () => {
    expect(agentRunResultSchema.safeParse({ ...baseEnvelope, status: "failed" }).success).toBe(false);
  });

  it("allows a success envelope to carry an error field", () => {
    expect(agentRunResultSchema.safeParse({
      ...baseEnvelope,
      error: { code: "warning", detail: "provider returned warning" },
    }).success).toBe(true);
  });

  it("rejects code artifacts without language", () => {
    expect(agentArtifactSchema.safeParse({
      ...baseArtifact,
      type: "code",
      name: "index.ts",
    }).success).toBe(false);
  });

  it("rejects artifacts without downloadUrl", () => {
    const { downloadUrl, ...value } = baseArtifact;
    expect(agentArtifactSchema.safeParse(value).success).toBe(false);
  });

  it("rejects summary artifacts with empty citations", () => {
    expect(agentSummaryArtifactSchema.safeParse({
      envelopeVersion: "v1",
      kind: "summary",
      clusterRunId: "run-1",
      summarizerDefinitionId: "lingxia-summarizer",
      summary: "summary",
      citations: [],
      producedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("rejects summary artifacts from non-summarizer definitions", () => {
    expect(agentSummaryArtifactSchema.safeParse({
      envelopeVersion: "v1",
      kind: "summary",
      clusterRunId: "run-1",
      summarizerDefinitionId: "other-summarizer",
      summary: "summary",
      citations: [{ agentDefinitionId: "a", runResultId: "r", excerpt: "x" }],
      producedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("rejects invalid cluster plan executionMode", () => {
    expect(agentClusterPlanSchema.safeParse({
      suggestions: [{ agentDefinitionId: "stock-analysis", reason: "needs analysis" }],
      executionMode: "dag",
      requiresUserConfirmation: true,
    }).success).toBe(false);
  });

  it("requires cluster plan user confirmation to be literal true", () => {
    expect(agentClusterPlanSchema.safeParse({
      suggestions: [{ agentDefinitionId: "stock-analysis", reason: "needs analysis" }],
      executionMode: "parallel",
      requiresUserConfirmation: false,
    }).success).toBe(false);
  });

  it("rejects cluster run status partial", () => {
    expect(agentClusterRunSchema.safeParse({
      id: "run-1",
      userId: 1,
      input: "x",
      selectedAgentIdsJson: ["stock-analysis"],
      status: "partial",
      resultsJson: [],
      createdAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("rejects per-agent envelope status partial", () => {
    expect(agentRunResultSchema.safeParse({ ...baseEnvelope, status: "partial" }).success).toBe(false);
  });

  it("rejects invalid provider runtimeFamily", () => {
    expect(agentProviderSchema.safeParse({
      id: "provider-1",
      providerKey: "bad-provider",
      displayName: "Bad",
      runtimeFamily: "task-stock",
      protocol: "http-json",
      baseEndpointRef: "BAD_URL",
      authType: "none",
      enabled: true,
      healthStatus: "unknown",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("accepts ssh reverse tunnel provider metadata", () => {
    expect(agentProviderSchema.safeParse({
      id: "provider-1",
      providerKey: "aws-hermes-prod",
      displayName: "AWS Hermes",
      runtimeFamily: "hermes",
      protocol: "http-json",
      baseEndpointRef: "AGENT_HERMES_TUNNEL_URL",
      transport: {
        kind: "ssh-reverse-tunnel",
        upstreamRef: "ec2-3-16-70-167:hermes",
        tunnelHealthCheckRef: "AGENT_HERMES_TUNNEL_HEALTH",
      },
      authType: "bearer-token",
      authRef: "AGENT_HERMES_PROD_TOKEN",
      enabled: true,
      healthStatus: "degraded",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("rejects invalid provider transport kind", () => {
    expect(agentProviderSchema.safeParse({
      id: "provider-1",
      providerKey: "bad-transport",
      displayName: "Bad Transport",
      runtimeFamily: "hermes",
      protocol: "http-json",
      baseEndpointRef: "BAD_URL",
      transport: { kind: "manual-ssh" },
      authType: "none",
      enabled: true,
      healthStatus: "unknown",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("accepts admin-only definition metadata", () => {
    expect(agentDefinitionSchema.safeParse({
      id: "agent-1",
      agentKey: "agent-1",
      displayName: "Agent One",
      shortDescription: "Does useful things",
      capabilityCategory: "general-assistant",
      providerId: "provider-1",
      enabled: true,
      healthStatus: "unknown",
      visibilityScope: "platform-global",
      metadata: { migrationNote: "runtime inferred; verify before dispatch wiring" },
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("accepts subscription-scoped definitions with quota and prompt refs", () => {
    expect(agentDefinitionSchema.safeParse({
      id: "agent-2",
      agentKey: "wealth-advisor",
      displayName: "Wealth Advisor",
      shortDescription: "Provides wealth analysis",
      capabilityCategory: "finance-research",
      providerId: "provider-1",
      enabled: true,
      healthStatus: "offline",
      visibilityScope: "subscription-scoped",
      visibilityConfigJson: { profileKeys: ["plus", "internal"] },
      quotaConfig: { dailyMax: 20, expiresAt: "2026-12-31T23:59:59.000Z" },
      systemPromptRef: "prompt:wealth-advisor-v1",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }).success).toBe(true);
  });
});
