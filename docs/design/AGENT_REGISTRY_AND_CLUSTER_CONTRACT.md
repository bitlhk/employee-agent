# Agent Registry And Cluster Contract

Date: 2026-05-03  
Status: Phase 0 contract.  
Owner: Lingxia agent plaza / remote agent integration / cluster execution.

## 1. Goal

Lingxia's Agent Plaza must move from hard-coded recommendation cards and
runtime-specific UI to a registry-driven capability system.

Users should see clear business capabilities such as "PPT 生成", "股票分析",
"新能源保险", or "代码开发". They should not need to understand whether the
agent is implemented by Hermes, Claude Code, OpenClaw, Hi-Agent, a local
service, AWS, or a future A2A endpoint.

This contract prevents four recurring problems:

- Main chat auto-recommends business agents through brittle rules, causing
  wrong routes such as "列技能" becoming a PPT recommendation.
- AWS remote agents are hard-coded into UI and backend flows instead of being
  modeled as first-class providers.
- Runtime family, deployment location, business capability, and profile/persona
  are mixed in one page, making product logic and state sync fragile.
- Multi-agent work has no explicit product surface, so the main chat becomes a
  dumping ground for implicit routing and recommendation cards.

## 2. Terms

- **Agent Definition**: The stable user-facing capability. Examples:
  `ppt-builder`, `stock-analysis`, `new-energy-insurance`, `code-writer`.
  Cluster preferences and UI selections always reference Definition ids.
- **Agent Provider**: The technical integration target. Examples:
  `aws-hermes-prod`, `aws-claude-code-prod`, `openclaw-local`,
  `hi-agent-local`, `lingxia-local`, `a2a-network`.
- **Agent Profile**: Optional runtime-specific role/configuration under a
  provider. A Hermes profile, Claude Code prompt template, OpenClaw workspace
  agent, Hi-Agent profile, or future A2A agent card can all be represented by
  `profileRef`.
- **Agent Cluster**: A user-created explicit selection of multiple Agent
  Definitions plus input. v1 executes the selected definitions in parallel and
  returns a partial-success result set.
- **Runtime Family**: The adapter family used by a provider:
  `hermes | claude-code | openclaw | hi-agent | lingxia-local | a2a`.
- **Brand Family**: Optional internal lineage such as `lingshu`, `lingjiang`,
  or `lingxi`. It is not part of the v1 user path.

## 3. Core Decisions

### 3.1 User-Facing Surface Is Capability-First

The default user surface is organized by capability category, not runtime,
deployment, or sub-brand.

Examples:

- 金融研究
- 保险与风控
- 办公生产力
- 代码与工程
- 通用助理
- 内部工具

`brandFamily` may exist as optional metadata for future storytelling, but v1
must not show "灵枢 / 灵匠 / 灵犀" as the primary navigation, filter, subtitle,
or recommendation reason. Product trust comes from clear capabilities and
permissions, not runtime branding.

### 3.2 Definition And Provider Are Decoupled

An Agent Definition is stable from the user's point of view. Its Provider,
endpoint, runtime family, or profile can change without breaking saved cluster
configuration.

For example, `stock-analysis` can initially point to a Lingxia-local service,
later move to OpenClaw, and eventually become an A2A endpoint. Existing cluster
preferences still store `stock-analysis`.

### 3.3 Remote Agents Are First-Class

AWS-hosted Hermes and Claude Code agents are not temporary fallbacks. They are
valid Agent Providers with the same lifecycle as local providers:

- health check
- visibility control
- credentials by `authRef`
- audit logging
- timeout and retry policy
- cluster execution support

Remote providers can be reached either directly or through a local tunnel
endpoint. A production example is an AWS Hermes provider exposed to Lingxia as a
local `127.0.0.1:<port>` SSH reverse tunnel. Admin and health-check code must
not assume a localhost endpoint means a local runtime.

#### 3.3.1 Runtime And Profile Split

v1 should prefer a small number of stable runtimes plus per-agent profile or
prompt configuration, not one long-running runtime process per business task.

The intended production shape is:

- one Hermes runtime/provider for GPT-family financial and research agents;
- one Claude Code runtime/provider for Claude-family code, PPT, and document
  generation agents;
- many Agent Definitions that point at those providers through `profileRef`,
  `systemPromptRef`, `remoteAgentId`, `localAgentId`, and adapter metadata.

For Hermes-backed agents, v1 can isolate task behavior through the Lingxia
adapter by passing task-specific instructions, session ids, and profile refs on
each run. This is sufficient for initial cluster dispatch and avoids operating
five independent Hermes services before the product surface is proven.

Hermes native profiles are still a first-class upgrade path. If a task needs
independent memory, skills, workspace files, credentials, or model settings,
`profileRef` may map to a Hermes profile or a profile-specific Hermes service.
This should be a deliberate isolation decision, not the default way to add a new
financial agent.

### 3.4 No AI Auto-Recommendation In Main Chat For v1

v1 explicitly removes main-chat business-agent auto recommendation.

Allowed:

- User opens Agent Plaza or Agent Cluster page and explicitly selects agents.
- User asks "去智能体广场看看有哪些 agent", and Lingxia links to the plaza.

Not allowed:

- Main PM guesses business intent and pushes agent cards.
- Main PM receives Agent Definition capability metadata for automatic routing.
- Fuzzy prompts such as "帮我做投资策略汇报" auto-dispatch to PPT/stock agents.

This avoids repeating the earlier "列技能 -> PPT" misroute.

### 3.5 Secrets Are Never Stored In Plain Registry Fields

Agent credentials must use `authRef`, not raw secrets.

Recommended MVP patterns:

```txt
authRef: "AGENT_HERMES_PROD_TOKEN"       # environment variable name
authRef: "AGENT_CLAUDE_CODE_TOKEN"       # environment variable name
authRef: "vault:agent/aws-hermes-prod"   # future secret manager reference
```

The frontend must never receive the raw token. Contract reviews should reject
schemas that place credentials directly in Agent Definition, Provider, Cluster,
or Run rows.

Production legacy note: the current `business_agents.api_token` column may hold
plain secrets from the pre-registry implementation. This is historical debt, not
a model to repeat. New Agent Registry writes must use `authRef`; Phase 3 admin
editing must include a migration path from raw DB tokens to server-side secret
references before exposing credential management.

### 3.6 Cluster Uses Explicit Selection

v1 cluster execution is not autonomous swarm behavior. The user selects one or
more Agent Definitions, provides input, and Lingxia dispatches fan-out calls.
Agents do not call each other in v1.

### 3.7 LLM-Assisted Selection Boundary

v1 does not enable planner-based agent selection. Users explicitly choose
agents.

v1.5 may add "AI 帮我选" as a dedicated planner endpoint, but it must follow
these rules:

- Planner is not the main chat PM.
- Planner has a dedicated endpoint such as `/api/agent-cluster/plan`.
- Planner uses an isolated prompt and audit path.
- Planner does not read main chat history.
- Planner cannot dispatch. It only returns suggestions.
- Planner output must pass server-side validation for `enabled`,
  dispatchable health state per §5.3, and viewer visibility before the frontend
  sees it.
- Frontend must require user confirmation before dispatch.
- Deployment must include a kill switch:
  `AGENT_PLANNER_ENABLED=false` disables the whole planner layer and returns
  to explicit selection.
- v1.5 planner can choose agents and execution mode, but must not rewrite
  per-agent input. Same-input fan-out remains required until v2.

Planner response shape:

```ts
type AgentClusterPlan = {
  suggestions: Array<{ agentDefinitionId: string; reason: string }>;
  executionMode: "parallel" | "sequential-2stage";
  requiresUserConfirmation: true;
};
```

`sequential-2stage` is the upper bound for v1.5. N-stage DAG workflows are v2.

## 4. Data Model

The exact persistence layer can be Drizzle tables, a migration-backed DB, or a
transitional JSON file during Phase 1. The schema semantics below are stable.

### 4.1 `lx_agent_providers`

Provider-level technical integration.

Fields:

- `id`
- `providerKey`: stable key, unique. Example: `aws-hermes-prod`.
- `displayName`: admin-facing name.
- `runtimeFamily`: `hermes | claude-code | openclaw | hi-agent | lingxia-local | a2a`.
- `protocol`: `http-json | sse | websocket | a2a`.
- `baseEndpointRef`: endpoint reference or environment variable name, not
  necessarily the raw URL. Example: `AGENT_HERMES_BASE_URL`.
- `transport`: optional transport metadata:
  - `kind`: `direct | ssh-reverse-tunnel | frpc | cloudflared`
  - `upstreamRef`: optional operator-facing upstream label, for example
    `ec2-3-16-70-167:hermes`.
  - `tunnelHealthCheckRef`: optional reference used by health checks to verify
    tunnel liveness separately from endpoint health.
- `authType`: `none | bearer-token | oauth | internal-token`.
- `authRef`: optional secret reference.
- `healthCheckPath`: optional provider-level health path.
- `enabled`: admin switch.
- `healthStatus`: `unknown | healthy | degraded | unhealthy | offline`.
- `lastCheckedAt`
- `lastError`
- `timeoutMs`: default provider timeout.
- `retryCount`: default retry count.
- `createdAt`
- `updatedAt`
- `updatedBy`

### 4.2 `lx_agent_definitions`

User-facing capability card.

Fields:

- `id`
- `agentKey`: stable key, unique. Example: `stock-analysis`.
- `displayName`
- `shortDescription`
- `longDescription`
- `capabilityCategory`: `finance-research | insurance-risk | office-productivity | code-engineering | general-assistant | internal-tool | custom`
- `providerId`
- `profileRef`: optional runtime-specific profile/workspace/card/template id.
- `endpointRef`: optional definition-level endpoint override.
- `authRef`: optional definition-level auth override. If omitted, use provider
  auth.
- `brandFamily`: optional `lingshu | lingjiang | lingxi | custom`, hidden in v1
  user UI.
- `iconName`
- `sortOrder`
- `tagsJson`
- `enabled`: admin switch.
- `healthStatus`: `unknown | healthy | degraded | unhealthy | offline`.
- `visibilityScope`: `platform-global | space-scoped | user-scoped | subscription-scoped`.
- `visibilityConfigJson`: scope-specific ids. See §5.
- `quotaConfig`: optional operational limits, for example
  `{ dailyMax?: number; expiresAt?: string | null }`.
- `systemPromptRef`: optional reference to a server-side prompt/profile. Legacy
  inline `systemPrompt` values must be treated as migration input, not exposed
  to regular users.
- `timeoutMs`: optional definition override.
- `retryCount`: optional definition override.
- `createdAt`
- `updatedAt`
- `updatedBy`

Important: `task-stock` or any current agent must not be forced into a new
runtime family without deployment verification. The contract can represent it
as:

```txt
runtimeFamily=openclaw,      profileRef=task-stock
runtimeFamily=lingxia-local, endpointRef=STOCK_AGENT_ENDPOINT
runtimeFamily=a2a,           profileRef=<a2a-agent-card-id>
```

The implementation chooses after verifying actual deployment.

### 4.3 `lx_agent_clusters`

Saved user cluster preference and reuse config.

Fields:

- `id`
- `userId`
- `spaceId`: nullable snapshot of the user's current collaboration space.
- `name`
- `description`
- `lastUsedAgentIdsJson`: array of Agent Definition ids, not Provider ids.
- `lastInput`
- `lastExecutionMode`: `parallel-append` for v1.
- `status`: `active | archived`
- `createdAt`
- `updatedAt`

`lastUsedAgentIdsJson` stores Definition ids. Provider ids are implementation
details and may change.

`spaceId` is an informational snapshot for reuse/audit. Invocation must use the
viewer's current profile/space and server-side visibility checks, not trust the
stored cluster `spaceId`.

### 4.4 `lx_agent_cluster_runs`

Audit and result record.

Fields:

- `id`
- `clusterId`: nullable for one-off cluster runs.
- `userId`
- `spaceId`: nullable snapshot.
- `input`
- `selectedAgentIdsJson`: array of Definition ids.
- `status`: `running | completed | partial_success | failed | cancelled | timeout`.
- `resultsJson`: array of result envelopes.
- `runtimeSnapshotJson`: per-agent runtime/provider/profile snapshot captured
  at dispatch time for audit. Provider remains source of truth for future
  calls, but historical runs must preserve what actually executed.
- `startedAt`
- `completedAt`
- `inputBytes`
- `outputBytes`
- `errorSummary`
- `createdAt`

Result envelope:

```ts
type AgentRunResult = {
  envelopeVersion: "v1";
  agentDefinitionId: string;    // Agent Definition id
  clusterRunId?: string;
  status: "success" | "failed";
  summary?: string;
  output?: string;              // human-readable text result
  artifacts: AgentArtifact[];
  metadata?: Record<string, unknown>;
  error?: { code: string; detail: string };
  producedAt: string;
};
```

`error` is required when `status !== "success"`. `artifacts` can be empty but
must always be present so the frontend can render by type instead of by agent.

Per-agent status is intentionally binary in v1: `success` or `failed`.
`partial_success` belongs to the cluster run when some agents succeed and some
agents fail.

### 4.5 Optional `lx_agent_profiles`

MVP can keep profiles as opaque `profileRef` values. If profiles become
user/admin-editable, introduce a table later:

- `id`
- `providerId`
- `profileKey`
- `displayName`
- `configRef`
- `version`
- `status`

Do not add this table until runtime adapters need shared profile management.

Profile storage must remain provider-agnostic. A Hermes profile, a Claude Code
prompt template, an OpenClaw workspace, and an A2A agent card can all be
represented by `profileRef`; provider adapters decide how to resolve it.

Do not encode business task identity by creating new `runtimeFamily` values.
For example, wealth management, bond analysis, credit risk, and claims
evaluation should remain Agent Definitions on top of a Hermes provider unless
their runtime isolation requirements justify a separate provider.

### 4.6 Result Type

Agent registry and cluster interfaces use the same Result pattern as
SkillRegistry, CronProvider, and CoopIdentity.

```ts
type AgentRegistryError =
  | { kind: "not_found"; detail: string }
  | { kind: "validation_failed"; detail: string }
  | { kind: "unauthorized"; detail: string }
  | { kind: "provider_unhealthy"; detail: string }
  | { kind: "dispatch_failed"; detail: string }
  | { kind: "not_implemented"; detail: string };

type AgentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentRegistryError };
```

## 5. Authorization And Visibility

Agent visibility must align with Collaboration Isolation.

### 5.1 Visibility Scopes

| Scope | Meaning | Required config |
|---|---|---|
| `platform-global` | Any active Lingxia user can see it | none |
| `space-scoped` | Only users in listed active collaboration spaces can see it | `spaceIds[]` |
| `user-scoped` | Only listed users can see it | `userIds[]` |
| `subscription-scoped` | Only users with listed subscription/profile tiers can see it | `profileKeys[]` |

### 5.2 Null Space Means Deny

For `space-scoped` agents, a viewer without an active non-null collaboration
space cannot see or invoke the agent. This mirrors Collaboration Isolation
§5.0.

For `subscription-scoped` agents, a viewer without an explicit matched
subscription/profile key is denied by default. Legacy `allowedProfiles` values
such as `plus,internal` must be migrated into `visibilityConfigJson.profileKeys`
before the Agent Registry path becomes authoritative.

Platform admins can inspect all definitions in admin UI, but regular Agent
Plaza and Cluster UI must apply visibility checks.

### 5.3 Enabled And Health Are Independent

Visibility and dispatch require both admin enablement and a dispatchable health
state.

`healthStatus="unknown"` is a grace state, not a permanent healthy state. It is
allowed only while a registry record has not yet been checked:

- Initial registry seed before the Phase 3 health check service exists.
- Agent/provider configuration changed and the first follow-up health check has
  not completed.
- Service startup within the first health check interval.

Phase 3 health check service must move every `enabled=true` Provider and
Definition out of `unknown` into `healthy`, `degraded`, `unhealthy`, or
`offline` within 5 minutes after startup or configuration change. A long-lived
`unknown` status is an operations warning.

| enabled | healthStatus | User list | Admin list | Cluster dispatch |
|---|---|---|---|---|
| true | healthy | visible | visible | allowed |
| true | unknown | visible with "未检测" badge | visible unchecked | allowed during grace |
| true | degraded | visible disabled with warning | visible warning | denied |
| true | unhealthy | hidden or disabled with warning | visible warning | denied |
| true | offline | hidden or disabled with warning | visible offline | denied |
| false | healthy | hidden | visible disabled | denied |
| false | unknown | hidden | visible disabled unchecked | denied |
| false | degraded | hidden | visible disabled warning | denied |
| false | unhealthy | hidden | visible disabled warning | denied |
| false | offline | hidden | visible disabled offline | denied |

Cluster execution invariant:

```ts
agent.enabled === true && (
  agent.healthStatus === "healthy" ||
  agent.healthStatus === "unknown" // grace state only; see §5.3
)
```

If either Provider or Definition is disabled, degraded, unhealthy, or offline,
the Definition is not dispatchable. Admin UI should show where the block comes
from. `unknown` should be visible as an unchecked state, not silently presented
as healthy. `degraded` is a real production state: it means an agent may still be
listed for awareness but should not be used for new cluster dispatch until
health recovers.

### 5.4 Cluster Membership Authorization

A user can create or run a cluster only with Agent Definitions they can
currently see and dispatch. Saved `lastUsedAgentIdsJson` must be revalidated on
every cluster open and run.

If an agent was previously saved but is no longer visible/healthy, keep it in
the saved config as disabled metadata but do not auto-run it.

## 6. Calling Protocol

Each runtime family is implemented by a Provider Adapter. Agent Definition
fields are normalized into the adapter's expected call shape.

### 6.1 Batch HTTP JSON

Default protocol for v1 remote agents.

Request:

```json
{
  "input": "用户输入",
  "context": {
    "adoptId": "lgc-xxx",
    "userId": 123,
    "spaceId": 1,
    "agentId": "stock-analysis",
    "profileRef": "task-stock"
  },
  "options": {
    "timeoutMs": 300000
  }
}
```

`context.userId` is an internal Lingxia audit correlation id. Remote agents
must not use it for authorization decisions. If one remote provider serves
multiple Lingxia deployments or tenants, v1.5 should replace it with an opaque
or hashed subject token.

#### 6.1.a Provider Wire Response

Remote providers can return a smaller wire response. This is provider protocol,
not the frontend contract.

```json
{
  "status": "success",
  "output": "结果文本",
  "metadata": {},
  "error": null
}
```

Provider wire error response:

```json
{
  "status": "error",
  "output": "",
  "metadata": {},
  "error": { "kind": "runtime_error", "message": "..." }
}
```

#### 6.1.b Lingxia Adapter Envelope

Every Provider Adapter must normalize the wire response into the full §9.7
`AgentRunResult` envelope before storing or returning it.

Fields filled by Lingxia adapter, not trusted from remote provider:

- `envelopeVersion`
- `agentDefinitionId`
- `clusterRunId`
- `producedAt`
- `status`

Fields derived from provider output:

- `summary`
- `output`
- `metadata`
- `error`

Artifacts can originate from provider output, but each artifact must pass §9.8
validation before being included in the envelope. Provider-supplied URLs are
not trusted; Lingxia signs preview/download URLs itself.

### 6.2 Streaming

SSE or websocket providers are allowed, but v1 cluster UI does not need to
merge multiple live streams into one real-time canvas. v1 may buffer each
agent's result and render completed cards.

Cluster v1 result delivery is batch-oriented: a run is considered renderable
only after the provider returns a complete `AgentRunResult` envelope. Streaming
tokens may be used internally for progress, but the artifact list is final only
when the envelope is complete. Multi-agent streaming UI is deferred.

Streaming support can be added per provider without changing Agent Definition.

### 6.3 A2A Future Adapter

A2A is a future protocol adapter, not a replacement for the registry model.
When introduced, it should map A2A agent cards into Provider/Profile metadata
while preserving Definition ids.

### 6.4 Timeout And Retry

Defaults:

- Timeout: 5 minutes.
- Retry count: 1.
- Retry only on transport failures or explicit retryable provider errors.
- Do not retry after a provider has produced a completed business result.

## 7. Health Check

Provider/Definition health is observable and separate from admin enablement.

Triggers:

- Background ping every 5 minutes.
- Manual "重新检测" in admin UI.
- Immediate check after provider or definition config changes.

Health result:

- `healthy`: provider/definition can accept calls.
- `unknown`: never checked or check pending.
- `degraded`: transport is reachable but endpoint/runtime is unstable, rate
  limited, or partially disabled. Do not dispatch new cluster runs.
- `unhealthy`: call failed or timed out.
- `offline`: transport or upstream is unavailable.

For tunneled providers, health checks have two layers:

1. Transport liveness: for example SSH reverse tunnel process/socket exists and
   still connects to the expected upstream.
2. Endpoint health: HTTP/SSE/A2A probe returns a valid health response.

Both layers must be represented in admin diagnostics. A tunneled provider can
move multiple Agent Definitions to `offline` together; this should be treated as
an operations event, not as independent per-agent failures.

Health failures:

- hide the agent from regular user selection;
- mark it with warning in admin UI;
- v1 should at least `console.warn` and write an audit record;
- v1.5 should notify admins through ChannelProvider (for example admin WeChat).

## 8. Audit

Every cluster run must create an audit record.

Minimum audit fields:

- caller `userId`
- `spaceId` snapshot
- selected Agent Definition ids
- input byte size
- output byte size
- per-agent status
- timeout/error kind
- timestamps

Do not store provider tokens, OAuth refresh tokens, or raw auth headers in run
records.

For banking deployments, audit records should be retained even when clusters
are archived.

## 9. Cluster Execution Model

### 9.1 v1 Execution

v1 cluster flow:

1. User opens Agent Cluster page.
2. UI loads last used Agent Definition ids and last input for the user/space.
3. User explicitly selects one or more visible healthy agents.
4. User submits input.
5. Lingxia validates all selected Definition ids again server-side.
6. Lingxia fan-outs calls in parallel.
7. Lingxia waits for all results or timeout.
8. UI renders result cards per agent.

Server-side revalidation is mandatory. It cannot be skipped based on client
claims, cached UI state, or a previous successful validation.

### 9.2 Reuse Config

v1 must include reuse config:

- remember last selected Agent Definition ids;
- remember last input;
- default the next cluster page open to these values;
- revalidate visibility/health before showing them as selectable.

This is required for usability. Without it, users must rebuild the cluster on
every visit and will not adopt the feature.

### 9.2.1 Memory Boundary

Agent Cluster v1 is task execution, not a long-lived personal assistant.

Rules:

- Cluster runs must not write long-term user memory.
- Provider adapters must use `clusterRunId` (or a run-scoped equivalent) as
  remote session id. They must not use a stable per-user session id for normal
  v1 cluster execution.
- Remote providers should be treated as stateless unless a provider adapter
  explicitly proves and documents a safe state model.
- Long-term memory belongs to the personal assistant / Hermes profile layer,
  where users can inspect and manage it.
- Follow-up runs must reference prior outputs explicitly through
  `parentRunId`, selected artifacts, or user-visible summaries. They must not
  rely on hidden provider memory.

This boundary keeps cluster runs reproducible and auditable for banking
deployments. It also prevents tool-style agents from silently becoming another
personal assistant memory surface.

### 9.3 Aggregation

v1 aggregation strategy is `append`:

- render each agent result independently;
- do not ask an LLM to synthesize/vote/merge by default;
- preserve per-agent attribution.

v1.5 candidates:

- merge summary;
- vote/compare;
- custom synthesis prompt;
- human-selected "best answer".

### 9.4 Failure Policy

Default v1 policy: `partial-success`.

If one agent fails, other successful results remain visible and the run status
is `partial_success`. A single failed agent must not discard other completed
work.

Optional future policy:

- `any-fail-all-fail`, only for explicitly configured workflows that require
  all agents to succeed.

### 9.5 No Autonomous Swarm In v1

Agents do not call each other. They do not dynamically add agents. They do not
modify cluster membership. They receive the same user input and return their
own result.

### 9.6 Cluster UI Surface

Agent Cluster v1 should be a first-class workspace page, not a right-side
floating drawer.

Recommended user-facing menu label: **智能体工作台**.

Reasoning:

- multi-select agent lists need space;
- run state, partial failures, artifacts, and history need durable layout;
- reuse config should feel like a workbench, not a transient suggestion card;
- enterprise users understand "workbench" better than "cluster".

The current right-side Agent Plaza drawer is a legacy browsing surface. Phase 2
may replace its data source with Agent Registry data, but should not add new
dispatch logic there. Phase 3 should evaluate whether the drawer is retired,
kept as a browse-only entry, or folded into the workbench page.

### 9.7 Standard Result Envelope

Every provider adapter must normalize provider output into the same envelope.
The frontend must render envelopes and artifacts generically. It must not
switch on specific agent ids.

```ts
type AgentRunResult = {
  envelopeVersion: "v1";
  agentDefinitionId: string;
  clusterRunId?: string;
  status: "success" | "failed";
  summary?: string;
  output?: string;
  artifacts: AgentArtifact[];
  metadata?: Record<string, unknown>;
  error?: { code: string; detail: string };
  producedAt: string;
};
```

Rules:

- `envelopeVersion` is required for future schema evolution.
- `agentDefinitionId` is required for provenance.
- `clusterRunId` is required when the result came from a cluster run.
- `summary` is a short text that can be shown in run lists or copied back to
  chat.
- `error` is required when `status !== "success"`.
- Per-agent status is binary in v1. Cluster-level `partial_success` is computed
  from multiple per-agent results.
- v1 delivery is batch-oriented. Streaming envelopes are deferred.

Summary artifacts:

```ts
type AgentSummaryArtifact = {
  envelopeVersion: "v1";
  kind: "summary";
  clusterRunId: string;
  summarizerDefinitionId: "lingxia-summarizer";
  summary: string;
  citations: Array<{
    agentDefinitionId: string;
    runResultId: string;
    excerpt: string;
  }>;
  producedAt: string;
};
```

Rules:

- A summary is a cluster-run artifact produced by a dedicated summarizer
  profile, not by the main chat PM.
- Summarizer output is stored on the cluster run. It does not automatically
  enter main chat context.
- If a user asks in main chat about a previous cluster run, Lingxia must fetch
  the summary artifact or run record explicitly; it must not rely on PM memory.
- `citations[]` is required so banking users can trace summary statements back
  to original agent outputs.
- Citation excerpts should be short text snippets from original `output` /
  `summary` fields, not entire source documents.

Summarizer input whitelist:

- per-agent `output`
- per-agent `summary`
- per-agent `error`
- artifact metadata: `{ name, type, sizeBytes, sha256 }`

Forbidden summarizer input:

- artifact binary bytes (`pptx`, `xlsx`, `pdf`, images, zip, etc.)
- provider raw metadata that may contain sensitive fields
- `workspacePath`
- signed `previewUrl` / `downloadUrl`

PPTX/XLSX/PDF bytes must not be sent into any LLM prompt in v1.

### 9.8 Artifact Rendering Contract

Artifacts are rendered by `type`, not by agent id.

```ts
type AgentArtifact = {
  id: string;
  type: "pptx" | "html" | "code" | "markdown" | "xlsx" | "pdf" | "image" | "zip" | "file";
  name: string;
  mimeType?: string;
  language?: string;        // required when type === "code"
  previewUrl?: string;
  downloadUrl: string;
  workspacePath?: string;
  metadata?: Record<string, unknown>;
};
```

Rendering rules:

- `pptx`: preview if available, download always.
- `html`: render in sandboxed iframe only.
- `code`: show code preview; `language` is required instead of guessing from
  extension.
- `markdown`: render markdown preview.
- `xlsx/pdf/image`: preview if renderer exists, download always.
- `zip/file`: download only unless preview support is added.

Security rules:

- `previewUrl` and `downloadUrl` must be signed short-lived URLs, TTL no longer
  than 15 minutes.
- TTL starts when Lingxia signs the URL for the viewer, not when the agent run
  completed. The frontend should request fresh signed URLs when reopening old
  runs or previews.
- URL resolution must be viewer-scoped. The server must re-check the viewer's
  space/session/artifact access before serving bytes.
- HTML previews must use an iframe sandbox. Script execution and top-frame
  navigation are forbidden in v1.
- Agents must not provide arbitrary frontend code or renderer components.

v2 escape hatch:

- a future `customRendererId?: string` can be introduced only through a
  platform-owned whitelist;
- agents cannot ship their own frontend renderer code.

### 9.9 Workspace And Artifact Ownership

Agent execution workspace and user workspace are separate layers.

| Layer | Ownership | Lifecycle | Who can delete |
|---|---|---|---|
| Agent execution workspace | per run, provider-owned temporary execution area | keep 24h after run, then GC | system only |
| Lingxia artifact store | per `clusterRunId`, Lingxia-owned delivery record | default 90 days, then cold/archive policy | user from workbench or admin |
| User workspace view | per `adoptId`, durable user file area | permanent until user deletes | user or admin |
| Audit metadata | per run immutable audit index | deployment compliance policy; banking default 7 years | admin retention policy only |

Rules:

- Agent providers write to their execution workspace or return artifacts to
  Lingxia. They do not directly mutate the user's durable workspace.
- Lingxia imports provider artifacts into the artifact store with provenance.
- "保存到我的工作区" must use copy-on-import, not a symlink or live reference.
  Artifact store GC must never delete a user-saved copy.
- Imported artifacts must include provenance metadata:
  `{ clusterRunId, agentDefinitionId, producedAt, originalArtifactId }`.
- User-facing workspace pages should show provenance where useful, but should
  not expose provider filesystem paths.
- Artifact store GC can delete or move bytes, but must retain audit metadata.
  At minimum the audit row must keep `{ runId, agentDefinitionId, artifactId,
  name, type, sizeBytes, sha256 }` so old runs remain explainable even when
  bytes have expired.
- User workspace view copies are independent of artifact store retention.
  Once copied into the user's workspace, the file is retained until the user or
  admin deletes that copy.

### 9.10 Follow-Up Semantics

v1 does not implement follow-up runs.

v1.5 may add follow-up via explicit cluster-run append operations. Remote
agents should be treated as stateless unless a Provider Adapter proves
otherwise. A follow-up is a new run whose input explicitly references a parent
run.

```ts
async function appendToCluster(
  parentRunId: string,
  input: string,
  scope:
    | { kind: "all" }
    | { kind: "single-agent"; agentDefinitionId: string }
    | { kind: "summarizer" },
): Promise<AgentResult<{ runId: string }>>;
```

The UI must make the scope visible, for example "追问基于本次 run
#cr-20260503-...".

## 10. Migration Plan

Phase 0:

- This contract.
- Shared types for Agent Definition / Provider / Cluster / Run.
- Stub `AgentRegistry` and `AgentClusterRunner` interfaces.

Phase 0 stub shape:

```ts
interface AgentRegistry {
  listProviders(): Promise<AgentResult<AgentProvider[]>>;
  listDefinitions(viewerUserId: number): Promise<AgentResult<AgentDefinition[]>>;
  getDefinition(definitionId: string): Promise<AgentResult<AgentDefinition>>;
  setEnabled(definitionId: string, enabled: boolean, actorUserId: number): Promise<AgentResult<AgentDefinition>>;
  dispatchToDefinition(definitionId: string, input: string, context: AgentCallContext): Promise<AgentResult<AgentRunResult>>;
  healthCheck(target: { providerId?: string; definitionId?: string }): Promise<AgentResult<HealthStatus>>;
}

interface AgentClusterRunner {
  createCluster(userId: number, input: CreateClusterInput): Promise<AgentResult<AgentCluster>>;
  loadLastUsed(userId: number, spaceId?: number | null): Promise<AgentResult<AgentCluster | null>>;
  runCluster(clusterId: string | null, input: RunClusterInput): Promise<AgentResult<{ runId: string }>>;
  getRunResult(runId: string): Promise<AgentResult<AgentClusterRun>>;
}
```

All Phase 0 implementations return `not_implemented` and have no production
behavior change.

v1 intentionally omits `removeDefinition` and `removeProvider` public APIs.
Deletion/retirement should be admin-only through DB migration or explicit
maintenance scripts until the lifecycle model is proven safe.

Phase 1:

- DB schema or registry storage for providers and definitions.
- Provider adapter interfaces.
- Health-check helper.
- Admin read-only list.

Phase 2:

- Replace hard-coded Agent Plaza data (`collabAgents.ts` and related UI) with
  registry-driven data.
- Current right-side Agent Plaza drawer stays visually unchanged in Phase 2
  unless a change is necessary to consume registry data.
- Keep main chat auto-recommendation disabled.
- Render only configured/visible/healthy definitions.

Phase 3:

- Admin UI for providers and definitions.
- Secret references by `authRef`.
- Manual health recheck.

Phase 4:

- Agent Cluster v1:
  - first-class "智能体工作台" page;
  - explicit multi-select;
  - parallel fan-out;
  - append results;
  - partial-success;
  - reuse config;
  - standard result envelope;
  - generic artifact renderer;
  - manual "生成综合总结" action using a dedicated summarizer profile.

Phase 5:

- v1.5 polish:
  - planner recommendation endpoint with user confirmation and kill switch;
  - `parallel | sequential-2stage` execution modes;
  - follow-up runs via `appendToCluster`;
  - synthesis strategies;
  - streaming result cards;
  - A2A adapter;
  - provider-level metrics and alerting.

## 11. Non-Goals For v1

- Main chat AI auto-recommending or auto-dispatching business agents.
- Autonomous swarm where agents discover/call each other.
- Cross-cluster memory/result sharing.
- Per-skill ACL within a remote agent.
- LLM-based synthesis/merge by default.
- Real-time merged multi-agent stream UI.
- Showing runtime family, deployment host, endpoint, or token metadata to
  regular users.
- Making `brandFamily` a visible product navigation dimension.
- Writing per-agent bespoke frontend UI in v1. Rendering is artifact-type
  driven. A future `customRendererId` must be platform-whitelisted and cannot
  load agent-provided frontend code.
- Planner auto-dispatch before user confirmation.
- Main chat PM acting as planner or summarizer.
- Sending artifact binary bytes into any LLM prompt.
- Planner rewriting per-agent input in v1.5.
- N-stage DAG workflow before v2.

## 12. Open Questions With Recommendations

### Q1. Where are remote agent credentials stored?

Recommendation: use `authRef` to reference server-side env or a future secret
manager. Do not store raw secrets in DB rows or expose them to frontend.

### Q2. What is the default cluster timeout?

Recommendation: 5 minutes, matching cron watcher timeout. Allow per-provider
and per-definition overrides.

### Q3. Should agent capability metadata be injected into main chat PM?

Recommendation: no for v1. Capability metadata is for Agent Plaza and Cluster
UI only. Main chat must not regain fuzzy agent recommendation.

### Q4. What happens when one agent fails in a cluster?

Recommendation: partial-success by default. Failed agent cards show error;
successful cards remain visible.

### Q5. Should `brandFamily` be shown?

Recommendation: no in v1. Keep it optional metadata only. Revisit after the
capability-first product experience is stable.

### Q6. Should `task-stock` be modeled as OpenClaw, Lingxia local, or A2A?

Recommendation: verify deployment before seeding. The schema can represent all
three. Do not encode task-specific names as new runtime families.

### Q7. Do clusters belong to user or space?

Recommendation: cluster rows are user-owned and snapshot `spaceId`. A user can
only run a cluster if all saved agent definitions are still visible in the
current space.

### Q8. Should regular users see unhealthy agents?

Recommendation: no for `unhealthy` and `offline`. `degraded` can be shown as a
disabled card with warning if that preserves user orientation, but Cluster
dispatch must still deny it. Admin UI shows non-healthy definitions with reason
and recheck action.

## 13. Review Checklist

Before Phase 1 implementation:

- Can `stock-analysis` be represented as OpenClaw profile, Lingxia-local
  endpoint, or A2A without schema changes?
- Are Agent Cluster saved selections stored as Definition ids?
- Are secrets represented only as `authRef`?
- Are `enabled` and `healthStatus` independent?
- Can `degraded` and `offline` production health states be represented without
  pretending they are healthy?
- Is main chat auto-recommendation explicitly out of scope?
- Does visibility integrate with collaboration space, subscription/profile
  scopes, and Null Space Means Deny?
- Can AWS Hermes and AWS Claude Code providers both be represented without
  hard-coded UI?
- Can tunneled remote providers be diagnosed separately from endpoint health?
