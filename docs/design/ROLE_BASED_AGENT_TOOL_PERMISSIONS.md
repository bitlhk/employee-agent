# Role-Based Agent Tool Permissions

This document records the proposed design for role-based Skill and MCP permissions in Employee Agent. It is a design note only; the current code does not yet implement the full role-template flow.

## Goal

When a user applies for a child Agent, the user can select a role such as customer manager, investment research, operations, or general office. The selected role determines which Skills and MCP tools the child Agent can see and use.

For the current MVP, role selection can be self-service. In a bank deployment, the selected role should be replaced or verified by enterprise IAM, HR, AD, or administrator approval.

The permission model should separate tool access from data access:

```text
Role template -> which tools and Skills this Agent can use
Real user identity -> which business data the tool can return
```

Example: two users can both have the customer-manager role and both use `wealth_assistant`, but the wealth data service must still return only each user's authorized customers.

## Current Code State

Current child Agent creation is driven by `claw.adopt` in `server/routers/claw.ts`. The request accepts only `permissionProfile`, currently `plus` or `internal`.

`claw_adoptions.permissionProfile` stores the legacy permission tier. The tier is still useful for sandbox and collaboration gating, but it is not a business role.

`provisionEmployeeAgentInstance` passes `--profile=<permissionProfile>` into `scripts/claw-provision.sh`.

`scripts/claw-provision.sh` currently maps `plus`, `internal`, `starter`, and `trial` to the same OpenClaw tool profile:

```json
{
  "profile": "coding",
  "deny": ["gateway", "nodes", "browser", "sessions_spawn"],
  "fs": { "workspaceOnly": true },
  "exec": { "ask": "off", "security": "full" }
}
```

The same script currently links every shared Skill from `.openclaw/skills-shared` into every child Agent workspace. This means Skill visibility is not yet role-scoped at provisioning time.

OpenClaw Agent config can already hold a per-agent `skills` array. Existing local configs show child Agents with `skills: [...]`, so Skill scoping can be implemented by writing and maintaining this field plus matching workspace links.

MCP servers are currently registered globally under `openclaw.json`:

```json
{
  "mcp": {
    "servers": {
      "wind_financial_docs": {},
      "wind_stock_data": {},
      "qieman": {},
      "wealth_assistant": {}
    }
  }
}
```

`/api/claw/mcp-tools/status` currently builds its response from the internal MCP catalog plus global OpenClaw MCP config. It does not yet filter the catalog by Agent role.

## OpenClaw MCP Filtering Capability

OpenClaw 5.28 supports per-agent MCP projection for the Codex app-server path through:

```json
{
  "mcp": {
    "servers": {
      "wealth_assistant": {
        "command": "...",
        "args": ["..."],
        "codex": {
          "agents": ["trial_lgc-xxx"]
        }
      }
    }
  }
}
```

Semantics:

- If `mcp.servers.<name>.codex.agents` is omitted, the server is projected to all Codex app-server Agents.
- If it is present and contains valid Agent ids, the server is projected only to those Agents.
- Empty, blank, or invalid lists fail closed.

This filtering is confirmed in OpenClaw's `buildCodexUserMcpServersThreadConfigPatch` implementation.

Important limitation: the schema says this field affects Codex app-server thread config only. The generic embedded/bundle MCP runtime still appears to merge global `mcp.servers` without the same per-agent filtering. For non-Codex runtimes such as a GLM path, use MCP service-side authorization as a short-term guard, or patch OpenClaw to support a runtime-agnostic per-agent MCP filter.

## Target Model

Introduce a role template layer:

```ts
type AgentRoleTemplate = {
  id: "customer_manager" | "investment_research" | "operations" | "general_office";
  label: string;
  permissionProfile: "plus" | "internal";
  allowedSkills: string[];
  allowedMcpServers: string[];
};
```

Example:

```ts
const customerManager = {
  id: "customer_manager",
  label: "客户经理",
  permissionProfile: "plus",
  allowedSkills: [
    "wealth-family-advisor",
    "wealth-healthcheck",
    "wealth-goalcalc",
    "portfolio-doctor"
  ],
  allowedMcpServers: [
    "wealth_assistant",
    "qieman"
  ]
};
```

The role template should drive three layers consistently:

```text
Frontend display
-> Employee Agent API authorization/filtering
-> OpenClaw/MCP runtime exposure
```


## Skill Metadata For Role Matching

Do not use the existing `skill_marketplace.category` column as the fine-grained
business scenario field.

Current database state:

- `skill_marketplace.origin` is a source/display grouping, such as
  `opensource`, `finance`, or `squad`. It answers where the Skill came from.
- `skill_marketplace.category` is a coarse enum limited to
  `finance | dev | data | writing | general | office | design`. It is useful
  for broad marketplace filtering, but it cannot safely store values such as
  `auto_insurance_sales` or `group_insurance_audit`; MySQL will coerce unknown
  enum values to an empty string.
- The marketplace card's top-right chip should display a business scenario
  label, not the source label. For example, squad Skills should show
  `债券交易`, `凭证审核`, `车险外呼`, `团险审核`, or `销售陪练`, rather than all showing
  `中队专区`.

Short-term implementation:

- Keep `origin=squad` for internally reviewed squad Skills.
- Keep `category=finance` for finance/insurance squad Skills until the schema is
  extended.
- In the marketplace frontend, map known `skillId` values to scenario labels for
  display only:

```text
bond-quote-parse                 -> 债券交易
credential-prompt-generator      -> 凭证审核
insurance-telesales-recommend    -> 车险外呼
group-insurance-audit            -> 团险审核
goldencoach-stage-evaluation     -> 销售陪练
```

Target schema:

Add explicit role-matching metadata instead of overloading `category`:

```ts
type SkillBusinessMetadata = {
  scenarioKey: string;       // e.g. "auto_insurance_sales"
  scenarioLabel: string;     // e.g. "车险外呼"
  businessDomain: string;    // e.g. "insurance" | "banking" | "securities"
  roleTags: string[];        // e.g. ["telesales", "customer_manager"]
  mcpServers: string[];      // MCP dependencies used by this Skill
  toolNames: string[];       // Optional sub-tool dependencies
};
```

Role templates should match on `scenarioKey`, `businessDomain`, and `roleTags`.
The UI chip can render `scenarioLabel`; authorization must be server-side and
must not rely on frontend display tags.

## Frontend Display Layer

The UI must not display tools outside the selected role.

For a customer-manager Agent, the MCP tools page should show customer-manager wealth tools and hide unrelated research, bond quote, or general platform MCP tools.

This must be server-driven. The frontend should render what the API returns, not keep its own hard-coded authority list.

Required changes:

- Add a role selector to the child Agent application flow.
- Show the selected role on Agent profile/settings pages.
- Filter Skills and MCP tools by role through server responses.
- Keep frontend cache versioned so an old MCP catalog cannot continue showing after role changes.

## Employee Agent API Layer

The server must enforce role filtering even if a user bypasses the frontend.

Required changes:

- Store the role template id for each child Agent.
- Resolve `allowedSkills` and `allowedMcpServers` from that role template.
- Filter `/api/claw/mcp-tools/status` by `allowedMcpServers`.
- Filter Skill list responses by `allowedSkills`.
- Reject Skill enable/install requests if the Skill is outside the Agent role.
- Record role and effective allowlists in audit events.

The existing `permissionProfile` should remain for sandbox and broad privilege tiering. It should not be reused as the business role.

## OpenClaw Runtime Layer

For Codex app-server Agents:

- When provisioning or updating an Agent, maintain `mcp.servers.<server>.codex.agents`.
- Add the Agent id to each allowed MCP server.
- Remove the Agent id from each disallowed MCP server.
- Write the Agent's `skills` array to the OpenClaw Agent config.
- Link only allowed shared Skills into the Agent workspace.

For non-Codex runtime paths:

- Short term: MCP servers must authorize by trusted OpenClaw context, especially `_meta.openclaw.agentId`.
- Long term: patch OpenClaw embedded/bundle MCP loading to support a runtime-agnostic field such as:

```json
{
  "mcp": {
    "servers": {
      "wealth_assistant": {
        "openclaw": {
          "agents": ["trial_lgc-xxx"]
        }
      }
    }
  }
}
```

The long-term patch should make generic MCP runtime filtering behave like the Codex `codex.agents` projection.

## MCP Data Authorization

Per-agent MCP filtering controls whether a model can see or call a tool. It does not decide which business rows the tool returns.

For data-sensitive MCPs, the MCP service should receive or resolve trusted context:

```text
MCP receives _meta.openclaw.agentId
-> MCP resolves agentId to real user or service identity
-> MCP/data service applies row-level authorization
-> MCP returns only authorized data
```

The model must not be trusted to pass user id, employee id, customer id ownership, or data scope.

## Audit Requirements

For bank-facing usage, audit should capture:

- Actor user id/name.
- Agent `adoptId` and runtime Agent id.
- Selected role template.
- MCP server and tool name.
- Skill id for Skill operations.
- Whether the tool was allowed or denied by role policy.
- Business-sensitive request summary after redaction.
- Result status, duration, and error code.

This makes it possible to answer: who used which role, which Agent used which MCP, whether the call was allowed, and what data domain was involved.



## OpenClaw Upgrade Posture

The current OpenClaw upgrade risk is materially lower than the earlier phase,
because two previously risky areas have been reduced:

- Codex streaming patches are no longer treated as a permanent local fork
  requirement. Employee Agent now owns stream normalization, timeout handling,
  recovery, and frontend reconciliation on its side.
- Stdio MCP has been removed from the primary business MCP path. Wind, Qieman,
  bond quote parsing, credential tools, wealth assistant, and group insurance
  audit are now modeled as HTTP/streamable-http MCP or platform tools. This
  avoids the old per-call stdio process/resource pressure.

Upgrade still needs validation around the interfaces we actively depend on:

- `openclaw.json` path and schema compatibility, especially `agents.list`,
  `workspace`, `skills`, `tools.alsoAllow`, `tools.sandbox.tools.alsoAllow`, and
  `mcp.servers`.
- Trusted runtime context propagation to MCP handlers, especially
  `_meta.openclaw.agentId`, `sessionKey`, `sessionId`, and `workspaceDir`.
  Data-sensitive MCP services must not depend on user-supplied ids.
- Per-agent MCP projection behavior. Codex app-server projection through
  `mcp.servers.*.codex.agents` existed in the previously reviewed OpenClaw path;
  newer versions should be rechecked before role-based MCP filtering is enabled.
- Gateway streaming events used by Employee Agent desktop/web paths, including
  assistant deltas, tool start/result events, terminal done/error events, and
  idle timeout behavior.
- Skill runtime loading: whether changes to `agents.list[].skills` and workspace
  skill folders require gateway restart or can be hot reloaded.
- MCP server transport compatibility for `streamable-http` and any OpenAI-style
  HTTP/SSE fallback paths.

Recommended sequence for the three environments:

1. First synchronize Employee Agent code and configuration across local,
   Shanghai, and Singapore experiment environments. Do not upgrade OpenClaw while
   EA code/config are divergent; otherwise failures cannot be attributed cleanly.
2. Freeze and back up current `openclaw.json`, `.env`, workspace directories,
   PM2 process list, and approved Skill/MCP catalog in each environment.
3. Upgrade Singapore experiment first. It is the right place to validate latest
   OpenClaw against a real server without risking Shanghai production users.
4. Run a fixed smoke suite in Singapore:
   - plain chat streaming
   - tool-call card rendering
   - web search / browser tool if enabled
   - Wind/Qieman public data MCP
   - bond quote parse MCP
   - credential MCP
   - group insurance audit MCP
   - wealth assistant MCP, including agentId/context propagation
   - Skill install/uninstall and marketplace install
   - file list/download if enabled
   - desktop connection if the desktop build points at the environment
5. Only after Singapore passes, upgrade local for developer parity and debugging.
6. Upgrade Shanghai last, during a planned maintenance window, with a rollback
   bundle ready: previous OpenClaw package/version, previous `openclaw.json`, and
   PM2 restart commands.

Do not upgrade Shanghai first. The expected remaining risks are not the old
Codex streaming patch or stdio MCP resource issue; they are schema/event drift,
trusted-context drift, and role/MCP permission semantics.

## Implementation Plan

1. Add role template definitions in Employee Agent.
2. Add a `roleTemplate` field to child Agent adoption/profile storage.
3. Add role selection to the Agent application UI.
4. Change provisioning to pass role template information into `claw-provision.sh`.
5. Update `claw-provision.sh` to write Agent `skills` and link only allowed shared Skills.
6. Add OpenClaw config mutation for `mcp.servers.*.codex.agents`.
7. Filter `/api/claw/mcp-tools/status` by role.
8. Filter Skill list/toggle/install APIs by role.
9. Add audit fields for role policy decisions.
10. For non-Codex runtimes, either enforce MCP service-side authorization or patch OpenClaw embedded MCP filtering.

## Open Questions

- Which roles should be part of the first MVP: customer manager, investment research, operations, general office?
- Should self-selected roles require admin approval before becoming active?
- Should role changes immediately reset active OpenClaw sessions so new MCP fingerprints take effect?
- Should shared Skills be deny-by-default for all roles except explicitly allowed ones?
- Should MCP tool catalog display aggregate server-level access only, or also enumerate all sub-tools for each MCP server?

