import type {
  AgentCallContext,
  AgentDefinition,
  AgentProvider,
  AgentResult,
  AgentRunResult,
} from "../../../../shared/types/agent";
import type { SecretHandle } from "../../../../shared/lib/secret-handle";

export type AgentProviderFetch = typeof fetch;

export type ProviderStreamEvent =
  | { type: "progress"; message: string; rawType?: string; metadata?: Record<string, unknown> }
  | { type: "text_delta"; text: string; rawType?: string; metadata?: Record<string, unknown> }
  | { type: "artifact_hint"; files: unknown[]; rawType?: string; metadata?: Record<string, unknown> }
  | { type: "error"; message: string; rawType?: string; metadata?: Record<string, unknown> };

export type ProviderDispatchInput = {
  definition: AgentDefinition;
  provider: AgentProvider;
  prompt: string;
  context: AgentCallContext;
  resolved?: ProviderResolvedBinding;
  onEvent?: (event: ProviderStreamEvent) => void;
};

export interface ProviderAdapter {
  dispatch(input: ProviderDispatchInput): Promise<AgentResult<AgentRunResult>>;
}

export type ProviderAdapterFactory = (provider: AgentProvider) => ProviderAdapter | null;

export type ProviderResolvedBinding = {
  endpoint?: string;
  auth?: SecretHandle | null;
  remoteAgentId?: string | null;
  localAgentId?: string | null;
  systemPrompt?: string | null;
  healthStatus?: string | null;
  transport?: {
    kind: "direct" | "ssh-reverse-tunnel" | "frpc" | "cloudflared";
  };
  metadata?: Record<string, unknown>;
};

export type ProviderBindingResolver = (input: {
  definition: AgentDefinition;
  provider: AgentProvider;
}) => Promise<AgentResult<ProviderResolvedBinding>>;

export function dispatchFailed(detail: string): AgentResult<AgentRunResult> {
  return { ok: false, error: { kind: "dispatch_failed", detail } };
}
