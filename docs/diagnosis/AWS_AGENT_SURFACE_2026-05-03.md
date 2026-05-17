# AWS Agent Surface Diagnosis - 2026-05-03

## Context

This note records the production surface discovered while preparing the Agent
Registry and Agent Cluster phases. It corrects two earlier assumptions:

- `127.0.0.1:8642` is not a local Hermes process. It is an SSH reverse tunnel
  accepted by local `sshd`.
- AWS-hosted Hermes is real in production, but it is reached through that local
  tunnel rather than through a direct public endpoint.

No production behavior was changed during this diagnosis.

## Verified Topology

Observed on `123.60.154.110`:

- `127.0.0.1:8642` is listened to by `sshd`, with traffic coming from
  `3.16.70.167`. It is the local ingress for an AWS Hermes tunnel.
- `127.0.0.1:8080` is a local Python service used by `task-trace`.
- `127.0.0.1:8188` is a local Uvicorn service used by `task-stock`.
- `0.0.0.0:19900` is a disabled local service path for `task-evolve`.

Enabled production business agents:

| Agent | Effective Runtime | Endpoint Shape | Notes |
|---|---|---|---|
| `task-hermes` | AWS Hermes | `127.0.0.1:8642` SSH reverse tunnel | `remoteAgentId=hermes-agent` |
| `task-my-wealth` | AWS Hermes | `127.0.0.1:8642` SSH reverse tunnel | wealth profile via legacy config |
| `task-bond` | AWS Hermes | `127.0.0.1:8642` SSH reverse tunnel | bond profile via legacy config |
| `task-credit-risk` | AWS Hermes | `127.0.0.1:8642` SSH reverse tunnel | credit-risk profile via legacy config |
| `task-claim-ev` | AWS Hermes | `127.0.0.1:8642` SSH reverse tunnel | insurance/claim profile via legacy config |
| `task-ppt` | AWS Claude Code | `3.16.70.167:19800` direct HTTP | selected by `localAgentId=task-ppt` |
| `task-code` | AWS Claude Code | `3.16.70.167:19800` direct HTTP | selected by `localAgentId=task-code` |
| `task-slides` | AWS Claude Code | `3.16.70.167:19800` direct HTTP | shared endpoint |
| `task-trace` | Lingxia local service | `127.0.0.1:8080` | degraded |
| `task-stock` | Lingxia local service | `127.0.0.1:8188` | healthy |

Disabled rows also exist for `task-evolve` and `task-trading`.

Observed on AWS host `3.16.70.167`:

- `0.0.0.0:8642` is a Hermes Python service.
- `0.0.0.0:19800` is the Claude Code proxy.
- The Hermes reverse tunnel is managed by a systemd service and forwards the
  AWS Hermes service back to Lingxia as `127.0.0.1:8642`.
- Hermes configuration supports native profiles. A profile has its own Hermes
  home, configuration, environment, memory, sessions, skills, gateway, cron, and
  logs.
- Current Hermes profile state after the no-traffic pilot:
  - `default` is running and still serves production Hermes traffic.
  - `mywealth` exists as a cloned Hermes profile and is stopped.
  - `mywealth` has cloned config/env/SOUL/skills, but no gateway, sessions,
    logs, cron jobs, or workspace traffic.
  - No production `business_agents` row points at `mywealth`.

This means the production shape is best described as a small number of remote
providers plus many Agent Definitions, not as one physical service per business
agent.

## Runtime/Profile Strategy

Recommended v1 direction:

- keep one Hermes provider for GPT-family financial/research agents;
- keep one Claude Code provider for Claude-family code, PPT, and document
  generation agents;
- represent each user-facing business capability as an Agent Definition;
- use `profileRef`, `systemPromptRef`, `remoteAgentId`, `localAgentId`, and
  adapter metadata to select task behavior at dispatch time.

Hermes-backed financial tasks can start with per-run instructions and
session-id isolation in the Lingxia adapter. That is enough to validate cluster
dispatch without operating many Hermes services.

Move a Hermes task to a native Hermes profile when it needs stronger isolation:

- independent long-term memory;
- independent skill set;
- independent workspace files;
- independent secrets or environment variables;
- different model/provider settings;
- audit requirements that require profile-level logs.

Do not create a new `runtimeFamily` for each financial task. `task-my-wealth`,
`task-bond`, `task-credit-risk`, and `task-claim-ev` should remain Agent
Definitions over the Hermes provider unless an explicit isolation requirement
justifies a separate Provider/Profile deployment.

Completed no-traffic profile pilot:

1. Created `mywealth` from `default` with `hermes profile create mywealth
   --clone --no-alias`.
2. Kept `mywealth` stopped; no new port or gateway process was started.
3. Verified production `default` remained running on the existing Hermes service.
4. Verified the profile is a candidate isolation unit, but it must not receive
   traffic until its SOUL/config are reviewed and AWS Hermes auth is refreshed.
5. Only after those checks should Lingxia map `task-my-wealth.profileRef` to
   this native Hermes profile.

## Production Schema Facts

The legacy `business_agents` table already has fields that the first Agent
Registry contract did not fully model:

- `apiUrl`, `apiToken`, `remoteAgentId`, `localAgentId`
- `kind`
- `healthStatus` values including `degraded` and `offline`
- `allowedProfiles`, for example `plus,internal`
- `maxDailyRequests`
- `expiresAt`
- `systemPrompt`

These should be represented in the Agent Registry as contract fields rather than
hidden in ad-hoc metadata.

## Security Debt

`business_agents.api_token` may contain plain agent tokens. This predates the
Agent Registry contract and violates the target rule that secrets are referenced
through `authRef`.

Do not expose credential editing in Agent Registry admin UI until there is a
migration path from raw DB tokens to server-side secret references.

## Health Model Implications

Tunneled providers need two health layers:

1. Transport/tunnel liveness: the local tunnel is listening and connected to the
   expected upstream.
2. Endpoint/runtime health: the HTTP/SSE/A2A probe succeeds.

When the SSH reverse tunnel fails, several Hermes-backed agents can go offline
together. Treat that as an operations event, not as independent agent failures.

Recommended operations follow-up:

- keep the SSH reverse tunnel under systemd or an equivalent supervisor;
- use keepalive options such as `ServerAliveInterval` and
  `ExitOnForwardFailure`;
- add a watchdog that checks both the listen socket and a lightweight endpoint
  probe;
- eventually notify admins through ChannelProvider.

Security follow-up: the current tunnel unit should be reviewed for credential
handling. Prefer key-based authentication or a managed secret reference over
plain credentials embedded in a unit file.

## `claw-business.ts` Dispatch Debt

`server/_core/claw-business.ts` currently routes many business agents through
large per-agent branches. Phase 4 cluster dispatch should not add more branches.

Target direction:

- introduce Provider adapters such as `HermesProvider`, `ClaudeCodeProvider`,
  and `LingxiaLocalProvider`;
- pass `AgentDefinition` + call context to the adapter;
- let adapters resolve `apiUrl`, `authRef`, `remoteAgentId`, `localAgentId`,
  `profileRef`, and prompt refs;
- keep per-agent behavior in data/profile config, not in 200-line route
  branches.

## Phase 4 Gate

Before cluster dispatch becomes authoritative:

- contract/types must represent `degraded`, `offline`, subscription/profile
  visibility, quotas, prompt refs, and tunneled providers;
- raw token storage must be tracked as a migration issue;
- tunnel health must be visible to admin/operators;
- current runtime assignments marked as inferred must be verified against actual
  dispatch before removing their migration notes.
