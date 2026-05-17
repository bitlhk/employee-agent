# JiuwenClaw Runtime MVP Design

**Status**: draft
**Date**: 2026-05-14
**Owner**: Linggan platform
**Target branch**: `feat/jiuwenclaw-runtime-mvp`

## 1. Decision

JiuwenClaw will replace the current Hermes position as the second runtime candidate.

The platform should keep two runtime lanes for now:

- `openclaw`: current stable production/test lane. Existing `lgc-*` behavior must not change.
- `hermes`: legacy compatibility lane, identified by `lgh-*`.
- `jiuwenclaw`: enterprise candidate lane, identified by `lgj-*`.

Do not build a full generic runtime abstraction in the MVP. The first implementation should be a small, explicit JiuwenClaw branch around the existing Hermes boundary. After chat, files, health, and media paths have each been integrated once, revisit whether a shared runtime interface is still useful.

## 2. Goals

- Validate JiuwenClaw enterprise branch as a backend runtime for Linggan chat.
- Add a clear JiuwenClaw branch next to the existing Hermes branch.
- Preserve the current frontend chat SSE contract so the web client does not need a rewrite.
- Keep OpenClaw code paths untouched for `lgc-*` agents.
- Prove tenant isolation through JiuwenClaw `service_id + agent_id + session_id`.

## 3. Non-Goals

- Do not replace OpenClaw in this phase.
- Do not remove Hermes code in the same change. `lgh-*` remains Hermes until deleted in a later cleanup.
- Do not redesign the whole runtime layer up front.
- Do not implement K8S deployment or sandbox hardening in this MVP.
- Do not make Shanghai production traffic depend on this before Singapore verification.

## 4. Current Baseline

Shanghai JiuwenClaw enterprise branch is running as of this design:

- Source: `/root/jiuwenclaw-enterprise-src`
- Branch: `dev/enterprise_kub`
- Commit: `3d1545c9 feat: claw manager基本框架`
- Service: `jiuwenclaw.service`
- Web: `http://123.60.154.110:5174`
- AgentServer: `ws://127.0.0.1:18092`
- Gateway: `ws://127.0.0.1:19000/ws`

The upstream package version still reports `0.1.10`; use git commit and branch as the actual runtime identity.

Enterprise branch behavior already verified:

- `session.list` with `svcProbeA / agentProbeA` sees only A sessions.
- `session.list` with `svcProbeB / agentProbeB` sees only B sessions.
- Cross query `svcProbeA / agentProbeB` returns empty.

## 5. Runtime Selection

### MVP Selection

Use an explicit runtime resolver in server code:

```ts
runtime = resolveAgentRuntime(adoptId, claw)
```

Rules:

- `lgc-*` -> `openclaw`
- `lgh-*` -> `hermes`
- `lgj-*` -> `jiuwenclaw`
- Hermes is frozen and should not receive new capability work

Do not reuse the old Hermes prefix for JiuwenClaw. `lgj-*` exists specifically to make JiuwenClaw traffic visible in code, logs, audit, and support conversations.

### Preferred Durable Model

Add a durable DB field later:

```ts
runtime: "openclaw" | "hermes" | "jiuwenclaw"
```

Do not block the chat MVP on this migration if a feature flag or controlled adoptId prefix is enough for the first test.

Recommended MVP env/config:

```bash
JIUWENCLAW_RUNTIME_ENABLED=true
JIUWENCLAW_AGENTSERVER_WS_URL=ws://127.0.0.1:18092
JIUWENCLAW_SERVICE_ID=linggan-shanghai
```

## 6. Identity Mapping Contract

Linggan has these identifiers today:

- `adoptId`: user-visible instance id: `lgc-*` OpenClaw, `lgh-*` Hermes, `lgj-*` JiuwenClaw
- `agentId`: runtime agent id in DB
- `userId`: platform user id
- `conversationId`: web/weixin conversation id
- `channel`: `web`, `weixin`, etc.

JiuwenClaw expects:

- `service_id`: tenant/service scope
- `agent_id`: agent scope inside the service
- `session_id`: conversation/session scope inside the agent

MVP mapping:

| Linggan | JiuwenClaw | Rule |
|---|---|---|
| deployment/env | `service_id` | `JIUWENCLAW_SERVICE_ID`, default `linggan-shanghai` |
| `adoptId` or DB `agentId` | `agent_id` | stable sanitized id, e.g. `trial_<adoptId>` or DB `agentId` |
| `channel + conversationId + epoch` | `session_id` | stable per conversation; epoch reset creates a new session id |

Important constraints:

- `service_id`, `agent_id`, and `session_id` must be deterministic.
- Session reset should not delete other user sessions.
- Never derive `session_id` from raw message content.
- Log all three values in structured metadata, but do not expose them to end users unless needed for debugging.

## 7. JiuwenClaw E2A Wire Contract

### Connection

MVP connects directly to AgentServer:

```text
ws://127.0.0.1:18092
```

For external access, use an SSH tunnel, internal proxy, or a service endpoint with TLS. Do not expose AgentServer publicly without auth and Origin policy review.

JiuwenClaw also supports a browser-facing WebSocket path:

```text
/ws -> JiuwenClaw Gateway ws://127.0.0.1:19000/ws
```

`app_web.py` can proxy `ws`/`wss` targets and rewrites `https://` targets to `wss://`. That means WSS is available when the Web service is placed behind TLS or configured with a `wss://` backend target.

MVP decision: Linggan does not hand the browser directly to JiuwenClaw `/ws`. employee-agent keeps the public chat API as SSE and opens the internal AgentServer WS itself. This keeps Linggan auth, audit, channel binding, and frontend rendering stable while JiuwenClaw is still being evaluated.

The server sends an initial ack frame:

```json
{ "type": "event", "event": "connection.ack", "payload": { "status": "ready" } }
```

### Request Envelope

Minimal request fields:

```json
{
  "protocol_version": "1.0",
  "request_id": "linggan-...",
  "timestamp": "2026-05-14T00:00:00+00:00",
  "identity_origin": "user",
  "channel": "web",
  "method": "chat.send",
  "params": {},
  "is_stream": true,
  "service_id": "linggan-shanghai",
  "agent_id": "jiuwen_lgj-...",
  "session_id": "web_<conversation>_e1"
}
```

### Chat Request

JiuwenClaw web currently uses:

```json
{
  "method": "chat.send",
  "params": {
    "session_id": "...",
    "content": "user input",
    "interactive_ask": true,
    "mode": "agent.fast",
    "model_name": "optional"
  },
  "is_stream": true
}
```

Linggan MVP should send the same semantic request through AgentServer, with `service_id`, `agent_id`, and `session_id` filled.

### Session List

```json
{
  "method": "session.list",
  "params": {},
  "is_stream": false,
  "service_id": "...",
  "agent_id": "..."
}
```

Expected body:

```json
{
  "result": {
    "sessions": [
      { "session_id": "...", "title": "...", "message_count": 0, "last_message_at": 0 }
    ]
  }
}
```

## 8. Linggan SSE Output Contract

The JiuwenClaw branch must preserve the existing Linggan chat response shape.

The frontend should continue receiving server-sent events equivalent to the OpenClaw path:

- assistant text delta
- thinking/reasoning delta if available
- tool start/result events if available
- final/completion event
- error event on runtime failure

Jiuwen E2A frames must be normalized into the existing chat event surface used by `claw-chat.ts`.

MVP minimum:

- stream assistant text
- emit final event
- emit meaningful error event
- preserve existing request cancellation behavior as best effort

MVP may defer:

- detailed tool rendering
- token usage summary
- trajectory/recover
- cron events

## 9. File and Workspace Contract

Local JiuwenClaw workspace path:

```text
/root/.jiuwenclaw/service_{service_id}/agent_{agent_id}/agent/jiuwenclaw_workspace
```

Session path:

```text
/root/.jiuwenclaw/service_{service_id}/agent_{agent_id}/agent/sessions/{session_id}
```

MVP chat does not require file APIs.

File integration phase can use direct local filesystem only when employee-agent and JiuwenClaw run on the same host and same mount namespace. For K8S, use one of:

- shared NFS/PVC mount with strict per-tenant path validation
- JiuwenClaw file API/proxy
- Linggan-owned file bridge

Do not assume host filesystem access once JiuwenClaw moves to K8S.

## 10. Security Boundary

Current enterprise branch local command guard is not a full sandbox. It restricts some command patterns and workdir, but local mode can still read host files outside the workspace in some cases.

JiuwenClaw sandbox wiring:

- `interface_deep.py` reads `sandbox.url` and `sandbox.type` from JiuwenClaw config.
- If both are present, it creates `OperationMode.SANDBOX` with `SandboxGatewayConfig`, `SandboxIsolationConfig`, and `PreDeployLauncherConfig`.
- If either value is missing, it creates `OperationMode.LOCAL`.
- Shanghai currently has no active `sandbox` block, so the running enterprise demo is local execution.

Sandbox implementation available in the branch:

- `jiuwenbox` provides a FastAPI sandbox service, default port `8321`.
- It uses `bubblewrap` plus policy-driven filesystem rules, bind mounts, namespace controls, capabilities, Landlock, seccomp, and network policy.
- The sample policy still uses host networking with outbound default allow. For enterprise rollout we need a tightened policy that keeps web search usable while blocking host metadata, SSH, lateral movement, and broad inbound access.

MVP security position:

- OK for Shanghai/Singapore engineering validation.
- Not OK as final enterprise hostile-user sandbox.

Before external customer rollout, require one of:

- JiuwenBox sandbox enabled and verified,
- K8S per-agent Pod isolation with NetworkPolicy and resource limits,
- or another OS/container isolation layer.

Web Origin note:

- Shanghai currently has `WS_ORIGIN_CHECK_ENABLED=false` to allow public demo access.
- Production should replace this with a domain allowlist, not leave it broadly disabled.

## 11. Implementation Plan

### Phase 0: Design and Branch

- Create `feat/jiuwenclaw-runtime-mvp`.
- Add this design doc.
- No service restart.

### Phase 1: Chat MVP

Add a JiuwenClaw-specific handler while leaving OpenClaw untouched.

Candidate files:

- `server/_core/claw-chat.ts`
- `server/_core/runtime/jiuwenclaw-runtime-adapter.ts`
- `server/_core/runtime/index.ts`
- possibly replace or bypass `server/_core/hermes-bridge.ts`

Implementation:

- Resolve runtime before current Hermes branch.
- For Jiuwen runtime, connect to `JIUWENCLAW_AGENTSERVER_WS_URL`.
- Build E2A `chat.send` request.
- Stream E2A responses into existing SSE output.
- Use deterministic `service_id`, `agent_id`, and `session_id`.

Acceptance:

- One web message streams back through Linggan chat UI.
- OpenClaw `lgc-*` chat still works unchanged.
- Jiuwen logs show correct `service_id`, `agent_id`, and `session_id`.

### Phase 2: Session Lifecycle

- Implement new conversation/session creation.
- Implement reset through epoch-based new `session_id`.
- Implement `session.list` for diagnostics.

Acceptance:

- Multiple conversations do not share memory unexpectedly.
- Reset creates a fresh Jiuwen session without deleting sibling sessions.

### Phase 3: Files and Core Files

- Map Linggan file API to Jiuwen workspace path only for same-host deployment.
- Preserve protected core file delete restrictions.
- Decide core file name mapping separately; Jiuwen uses a different default workspace structure than OpenClaw.

Acceptance:

- List/read/write/download works for Jiuwen MVP agent.
- Protected root files cannot be deleted by user or agent path traversal.

### Phase 4: Weixin and Media

- Confirm generated images/SVG/documents return through Linggan media bridge.
- Avoid exposing absolute host paths to users.
- Convert runtime file path to Linggan download URL.

### Phase 5: Provision and Health

- Add runtime-aware provisioning.
- Add health panel entry for JiuwenClaw AgentServer/Gateway.
- Keep OpenClaw health unchanged.

### Phase 6: Sandbox and K8S

- Validate JiuwenBox or K8S isolation.
- Add NetworkPolicy/resource limits.
- Run malicious command probes before customer rollout.

## 12. Test Matrix

| Area | Test |
|---|---|
| OpenClaw regression | Existing `lgc-*` chat still streams |
| Jiuwen chat | `chat.send` returns assistant text and final event |
| Tenant isolation | A agent cannot see B session through `session.list` |
| Session reset | Reset does not leak previous context |
| Error handling | Jiuwen down returns user-safe runtime error |
| Files phase | Same-host workspace path cannot escape tenant dir |
| Web origin | Demo domain and IP connect; production has allowlist |

## 13. Rollback

Rollback must be simple during MVP:

- Disable `JIUWENCLAW_RUNTIME_ENABLED`.
- Route test users back to OpenClaw or freeze Jiuwen test ids.
- Do not touch `lgc-*` OpenClaw paths.
- Shanghai JiuwenClaw runtime rollback is available at:
  `/root/backups/jiuwenclaw-upgrade-20260514-104435/rollback.sh`

## 14. Open Questions

- Should Jiuwen MVP use a new adoptId prefix, or a DB `runtime` field immediately?
- Should Hermes code be left as dead fallback for one release or removed after Jiuwen chat MVP?
- Should employee-agent connect to Jiuwen AgentServer directly, or through Jiuwen Gateway?
- What is the final production Origin policy for Jiuwen Web/Gateway?
- Which sandbox path is preferred: JiuwenBox or K8S per-agent Pod?

## 15. Recommended Next Step

Start with Phase 1 only: Jiuwen chat MVP behind an explicit feature flag. Do not touch OpenClaw files, OpenClaw provisioning, or Shanghai running employee-agent service until Singapore validation passes.
