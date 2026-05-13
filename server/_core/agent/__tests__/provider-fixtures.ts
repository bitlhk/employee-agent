import type { AgentDefinition, AgentProvider } from "../../../../shared/types/agent";

export function provider(overrides: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id: "provider-1",
    providerKey: "provider-1",
    displayName: "Provider One",
    runtimeFamily: "hermes",
    protocol: "http-json",
    baseEndpointRef: "http://provider.test/run",
    authType: "none",
    enabled: true,
    healthStatus: "healthy",
    timeoutMs: 1000,
    retryCount: 0,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...overrides,
  };
}

export function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    agentKey: "agent-1",
    displayName: "Agent One",
    shortDescription: "Useful test agent",
    capabilityCategory: "general-assistant",
    providerId: "provider-1",
    profileRef: "agent-1",
    enabled: true,
    healthStatus: "healthy",
    visibilityScope: "platform-global",
    visibilityConfigJson: {},
    timeoutMs: 1000,
    retryCount: 0,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...overrides,
  };
}

