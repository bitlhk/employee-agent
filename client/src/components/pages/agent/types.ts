export type AgentPanel = "overview" | "files";

export type ToolPolicy = {
  adoptId: string;
  profile: string | null;
  source: "agent_override" | "global_default" | "default";
  allow: string[];
  alsoAllow: string[];
  deny: string[];
};

export type EffectiveTool = {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin" | "channel";
  configuredAllowed: boolean;
  runtimeAvailable: boolean;
  unavailableReason?: string;
  badge?: string;
};

export type EffectiveResp = {
  adoptId: string;
  sessionKey: string | null;
  resolutionMode: "explicit_session" | "recent_session" | "static_fallback";
  groups: Array<{ id: string; label: string; tools: EffectiveTool[] }>;
};

export type CoreFileMeta = { name: string; exists: boolean; updatedAt: string | null; size: number | null };
