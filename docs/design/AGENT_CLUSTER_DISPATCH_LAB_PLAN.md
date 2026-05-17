# Agent Cluster Dispatch Lab Plan

Status: draft for Phase 4 entry.

This plan turns the Agent Registry contract into a safe dispatch experiment
without changing the existing Agent Plaza or main chat behavior.

## Goal

Create an admin-only "Agent Cluster Lab" that can call a small set of registered
business agents through Provider adapters, display results side by side, and
record enough diagnostics to decide how to build the formal Agent Workspace.

## Non-Goals

- Do not change main chat.
- Do not re-enable fuzzy agent recommendation.
- Do not replace the current Agent Plaza.
- Do not auto-save agent artifacts into user workspace.
- Do not run autonomous swarm/planner behavior.
- Do not expose provider tokens or raw endpoint details to the browser.

## Feature Flags

```txt
AGENT_CLUSTER_LAB_ENABLED=false
AGENT_CLUSTER_LAB_ALLOW_USER_IDS=1,2
AGENT_CLUSTER_LAB_MAX_AGENTS=3
AGENT_CLUSTER_LAB_TIMEOUT_MS=300000
```

Default is off. If the flag is off, the backend route must return 404 or
forbidden, not a partially working UI.

## Entry Point

Use an admin/allowlist-only route:

```txt
/admin/agent-cluster-lab
```

The formal customer-facing name can later become "智能体工作台". The lab name is
intentional: it tells reviewers this is a gray path, not a stable product entry.

## Backend Shape

```ts
interface ProviderAdapter {
  dispatch(input: {
    definition: AgentDefinition;
    provider: AgentProvider;
    prompt: string;
    context: AgentCallContext;
  }): Promise<AgentResult<AgentRunResult>>;
}
```

First adapters:

1. `HermesProvider`
   - Covers AWS Hermes through the `127.0.0.1:8642` SSH reverse tunnel.
   - First test candidate: `task-my-wealth` or `task-bond`.
2. `ClaudeCodeProvider`
   - Covers direct AWS Claude Code endpoint `3.16.70.167:19800`.
   - First test candidate: `task-ppt`.
3. `LingxiaLocalProvider`
   - Covers local services such as `task-stock`.
   - Add after the first two remote adapters pass.

Do not add new per-agent branches to `claw-business.ts`. If a behavior looks
agent-specific, encode it as data/profile config first; only add adapter code if
the protocol truly differs.

## Run API

```http
POST /api/admin/agent-cluster-lab/run
{
  "agentDefinitionIds": ["task-my-wealth", "task-ppt"],
  "prompt": "请基于上传材料给出投资分析和汇报提纲"
}
```

Server-side requirements:

- Re-read Agent Registry.
- Verify every selected definition is enabled, visible to the caller, and in a
  dispatchable health state.
- Enforce `AGENT_CLUSTER_LAB_MAX_AGENTS`.
- Fan out in parallel by default.
- Return partial success if one provider fails.
- Attach `runtimeSnapshotJson` with provider key, runtime family, health state,
  and transport kind.
- Never return raw auth refs, tokens, internal tunnel endpoint details, or
  migration notes to the browser.

## Result UI

Lab result cards:

- one card per selected Agent Definition;
- status: success / failed / timeout;
- output summary text;
- artifacts list using the generic artifact renderer contract;
- raw diagnostics behind an admin-only accordion.

No custom per-agent UI in v1 lab.

## Safety Rules

- No main-chat context is read or written.
- No artifact bytes are sent to a summarizer.
- No automatic summary runs unless the admin explicitly clicks a separate
  "生成综合总结" button in a later phase.
- Failed agents do not hide successful agents.
- The route must be idempotent enough for repeated smoke tests; use
  `SMOKE_AGENT_CLUSTER_*` run labels when tests are automated.

## First Manual Test

1. Enable lab flag for the admin user only.
2. Open `/admin/agent-cluster-lab`.
3. Select:
   - one Hermes definition, e.g. `task-my-wealth`;
   - one Claude Code definition, e.g. `task-ppt`.
4. Prompt:
   ```txt
   请用三句话说明你能完成什么任务，不要生成文件。
   ```
5. Expected:
   - both cards return within timeout;
   - no raw endpoint/token appears in the browser payload;
   - if one fails, the other result remains visible;
   - backend logs include provider, definition, duration, and status.

## Phase Split

Phase 4.1:

- Backend adapter interface.
- HermesProvider + ClaudeCodeProvider minimal dispatch.
- Admin-only run route.
- No UI beyond a simple internal page or curl script.

Phase 4.2:

- Lab UI with multi-select and result cards.
- Generic artifact rendering only.

Phase 4.3:

- Add LingxiaLocalProvider and `task-stock`.
- Add repeatable Playwright smoke case.

Phase 4.4:

- Decide whether the lab graduates into customer-facing "智能体工作台".
