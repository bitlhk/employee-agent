# JiuwenClaw Capability Integration Design

**Status**: draft  
**Date**: 2026-05-14  
**Scope**: employee-agent + JiuwenClaw enterprise branch  
**Decision**: keep a JiuwenClaw-specific lane first. Do not extract a generic runtime abstraction until the JiuwenClaw lane has real parity data.

## 1. Runtime Marker

Use prefixes as operational markers:

| Prefix | Runtime | Status |
|---|---|---|
| `lgc-*` | OpenClaw | stable lane, keep unchanged |
| `lgh-*` | Hermes | legacy compatibility lane, frozen |
| `lgj-*` | JiuwenClaw | new enterprise runtime lane |

This keeps old Hermes behavior inspectable while JiuwenClaw is being built. It also avoids support confusion: `lgh` means Hermes, `lgj` means JiuwenClaw.

## 2. Current Code Reality

employee-agent already has runtime-specific surface area:

| Capability | Current files | Current behavior |
|---|---|---|
| Chat | `server/_core/claw-chat.ts`, `server/_core/hermes-bridge.ts`, `server/_core/jiuwenclaw-bridge.ts` | OpenClaw `lgc-*`, Hermes `lgh-*`, JiuwenClaw `lgj-*` |
| Frontend transport | `client/src/pages/Home.tsx` | OpenClaw uses WSS first; Hermes/JiuwenClaw use HTTP SSE |
| Files | `server/_core/claw-files.ts`, `server/_core/hermes-files.ts` | OpenClaw local workspace provider; Hermes provider; JiuwenClaw provider not built |
| Core files | `server/_core/claw-core-files.ts`, `server/_core/hermes-memory.ts` | OpenClaw whitelist files; Hermes profile files; JiuwenClaw not mapped |
| Memory | `server/_core/claw-memory.ts`, `server/_core/hermes-memory.ts` | OpenClaw workspace memory files; Hermes profile memory files; JiuwenClaw not mapped |
| Cron | `server/_core/claw-cron.ts`, `server/_core/hermes-cron.ts`, `server/_core/cron/openclaw-cron-provider.ts` | OpenClaw/Hermes providers; JiuwenClaw provider not built |
| Skills | `server/routers/claw.ts`, `skill-registry`, `hermes-skills` | OpenClaw market install + registry; Hermes read-only provider; JiuwenClaw needs its own contract |
| Audit | `server/routers/claw.ts`, `audit-events`, `jiuwenclaw-exec.log` | Platform audit exists; JiuwenClaw chat logs currently local JSONL only |

JiuwenClaw enterprise branch has actual multi-tenant primitives:

| Primitive | JiuwenClaw code | Notes |
|---|---|---|
| Tenant path | `jiuwenclaw/utils.py:get_multi_tenant_user_workspace_dir()` | `~/.jiuwenclaw/service_{service_id}/agent_{agent_id}` |
| Workspace | `get_agent_workspace_dir()` | default path resolves under `service_default/agent_default/agent/jiuwenclaw_workspace`; request-level tenant routing must be verified for non-default agents |
| Sessions | `get_agent_sessions_dir()`, `agentserver/session_metadata.py` | session metadata is filesystem based |
| Chat request | `agentserver/deep_agent/interface_deep.py` | reads `request.params["query"]`; `content` alone is insufficient |
| Cron | `agentserver/deep_agent/cron_runtime.py`, `agentserver/tools/cron_tools.py` | internal cron exists, cron-only schedule support is narrower than Linggan UI model |
| Channels | `channel/wechat.py`, `wecom.py`, `telegram.py`, `discord.py`, gateway pipeline | JiuwenClaw has channel adapters, but Linggan should keep channel ownership initially |
| Skill dev | `agentserver/skilldev/*` | strong skill-generation pipeline, not the same as Linggan skill market install |
| Memory | `agentserver/memory/manager.py` | JiuwenClaw has its own memory manager and file watcher behavior |
| Sandbox | `interface_deep.py` sandbox config + JiuwenBox/K8S code | local mode is not enough for hostile enterprise isolation |

## 3. Principle

Do not make JiuwenClaw pretend to be OpenClaw. Build a JiuwenClaw adapter where Linggan needs platform continuity:

- Linggan keeps identity, ownership, billing, admin, channels, audit, and public file URLs.
- JiuwenClaw owns agent reasoning, workspace execution, session state, built-in memory, built-in cron tools, and skill development primitives.
- Anything exposed in the Linggan UI must pass through Linggan auth and audit first.

## 4. Identity And Paths

Mapping:

| Linggan | JiuwenClaw |
|---|---|
| `adoptId=lgj-xxx` | public instance id |
| `userId` | platform owner, never trusted from runtime |
| `agentId` | JiuwenClaw `agent_id`, sanitized |
| env deployment | JiuwenClaw `service_id` |
| `channel + conversationId + epoch` | JiuwenClaw `session_id` |

Current MVP path formula:

```text
~/.jiuwenclaw/service_{service_id}/agent_{agent_id}/agent/jiuwenclaw_workspace
~/.jiuwenclaw/service_{service_id}/agent_{agent_id}/agent/sessions
```

Required before file/memory UI parity:

- Add a `jiuwenclaw-paths.ts` helper in employee-agent.
- Compute paths only from sanitized `service_id` and `agent_id`.
- Never accept a runtime-returned absolute path as a public URL.
- For K8S, replace direct filesystem access with JiuwenClaw file API, NFS mount, or object-store bridge.

## 5. Chat

Current MVP is acceptable as Phase 1:

- employee-agent opens `ws://127.0.0.1:18092`.
- Sends E2A `chat.send`.
- Must include both `params.query` and `params.content`; JiuwenClaw reads `query`.
- Normalizes `e2a.chunk` to OpenAI-compatible SSE for current Linggan frontend.

Transport/WSS notes:

- JiuwenClaw supports WebSocket at two layers:
  - Web/Gateway path: browser connects to `/ws`; `app_web.py` proxies it to Gateway `ws://127.0.0.1:19000/ws`.
  - AgentServer path: backend connects directly to `ws://127.0.0.1:18092` for E2A `chat.send`.
- `app_web.py` accepts `ws`, `wss`, `http`, and `https` proxy targets and rewrites `https://` targets to `wss://`.
- The Linggan MVP intentionally keeps the browser on HTTP SSE and uses backend-to-AgentServer WS internally. This preserves Linggan auth, channel ownership, audit, and existing frontend behavior.
- A later WSS frontend path is possible, but it should go through Linggan auth/session checks first instead of exposing JiuwenClaw Gateway directly.

Next fixes:

- Filter internal `context.*` and `chat.usage_metadata` events from normal user display; keep them for logs/audit.
- Add `lgj-*` smoke tests with direct HTTP SSE.
- Add timeout and retry policy around AgentServer connection.
- Add a `/health` detail entry for JiuwenClaw AgentServer and Gateway.

## 6. Workspace And Files

Linggan today exposes a file capability API. For JiuwenClaw:

Phase 1:

- Add `jiuwenclaw-files.ts` provider with read/list/download/upload/delete under the computed workspace root.
- Reuse current file limits and extension whitelist from `claw-files.ts`.
- Preserve protected root-file delete restriction.
- Emit platform audit for upload/delete/download.

Phase 2:

- Move file access behind a JiuwenClaw file proxy or object-store layer.
- Support generated media/file return to WeChat by converting runtime file paths into Linggan signed/public file URLs.

Do not expose raw paths such as `/root/.jiuwenclaw/...` to users or channels.

## 7. Core Files And Memory

Current Linggan core files include `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`, `IDENTITY.md`, `HEARTBEAT.md`, and `USER.md`.

JiuwenClaw has its own memory manager and workspace structure, so use a compatibility layer first:

Phase 1:

- Map Linggan core files to JiuwenClaw workspace root files.
- Keep user-visible edit/read APIs the same.
- Preserve ETag conflict checks.
- Keep delete blocked for protected core files.
- Log all writes in platform audit.

Phase 2:

- Decide which files become JiuwenClaw-native config/memory and which remain Linggan-side profile files.
- Sync `SOUL/USER/MEMORY` into JiuwenClaw prompt or memory only through an explicit sync function.
- Avoid double-writing if JiuwenClaw memory manager already persists the same information.

## 8. Skills

This is the highest-risk capability because Linggan and JiuwenClaw have different skill concepts.

Current Linggan:

- OpenClaw skills are installed via skill market and workspace/agent skill directories.
- Hermes skills are read-only from Hermes profile skills.

JiuwenClaw:

- Has a strong `skilldev` pipeline.
- Has workspace `skills` directories and registered skill dirs.
- Has generated package workflows, but not necessarily the same install/uninstall semantics as Linggan market.

Recommended plan:

Phase 1:

- Show JiuwenClaw skills as read-only/runtime-managed.
- Disable Linggan market install for `lgj-*` until install semantics are verified.
- Allow importing Linggan skill packages only into a sandbox test workspace, not production agent workspace.

Phase 2:

- Build `jiuwenclaw-skills.ts` provider.
- Support list/import/enable/disable only if JiuwenClaw exposes stable file or API semantics.
- Keep skill generation as a JiuwenClaw-native feature instead of forcing it through Linggan's old market model.

## 9. Cron And Scheduled Tasks

Linggan cron product model supports interval, once, cron, prompt, delivery channels, and run audit.

JiuwenClaw has internal cron tools and scheduler, but `cron_runtime.py` currently maps legacy params primarily to cron expressions and target channels.

Recommended plan:

Phase 1:

- Keep Linggan cron as the source of truth for `lgj-*`.
- On trigger, Linggan calls `chat.send` with `channel="cron"` and a deterministic `session_id`.
- Delivery remains Linggan-owned, so WeChat/WeCom output behavior stays consistent.

Phase 2:

- Evaluate JiuwenClaw native cron only for jobs created from inside JiuwenClaw conversations.
- If native JiuwenClaw cron is used, mirror job metadata back to Linggan for admin visibility and audit.

Do not split scheduled-task ownership between two schedulers without a clear source-of-truth flag.

## 10. Channels

Keep Linggan as channel owner for now:

- Web, WeChat, WeCom, DingTalk, Feishu should enter employee-agent.
- employee-agent maps the request to JiuwenClaw `channel` and `session_id`.
- employee-agent owns attachment upload, media URL conversion, and channel-specific delivery.

JiuwenClaw channel adapters can be evaluated later, but using them directly would bypass Linggan auth/audit/channel binding and create duplicate configuration surfaces.

## 11. Security Boundary

Current local JiuwenClaw mode is not enough for untrusted enterprise tenants.

Current code behavior:

- `interface_deep.py` creates `OperationMode.SANDBOX` only when config contains both `sandbox.url` and `sandbox.type`.
- Without those two values, it falls back to `OperationMode.LOCAL` with a local work directory.
- Shanghai currently has no active `sandbox` block in JiuwenClaw config, so the verified demo path is local execution, not sandboxed execution.

JiuwenClaw sandbox option:

- The enterprise branch includes `jiuwenbox`, a FastAPI sandbox service backed by `bubblewrap`.
- JiuwenBox policy supports filesystem allowlists, bind mounts, process namespace controls, capabilities, Landlock best-effort enforcement, seccomp syscall blocking, and network policy.
- The default JiuwenBox port is `8321`; JiuwenClaw should point `sandbox.url` at that service and set `sandbox.type` to the matching launcher type before tool execution is considered sandboxed.
- The current sample policy uses `network.mode: host` with outbound default allow. That is acceptable for web search experiments, but not sufficient as the final enterprise network boundary.

Required before broad rollout:

- Run JiuwenClaw with JiuwenBox or K8S-level isolation and verify that `OperationMode.SANDBOX` is actually selected.
- Restrict workspace file access to the tenant root.
- Keep AgentServer bound to localhost or private service mesh.
- Enable Origin/auth policy before public exposure.
- Block raw absolute paths in model-visible file events.
- Preserve Linggan-side limits for uploads, file count, file size, and protected core files.
- Keep network search allowed, but separate it from arbitrary shell/network tools.

## 12. Implementation Phases

Phase 1, already started:

- `lgj-*` chat path.
- HTTP SSE frontend path.
- TypeScript compile.
- Shanghai smoke test.

Phase 2, next:

- Capability design accepted.
- Add runtime resolver helper shared by chat/files/memory/cron/routes.
- Add JiuwenClaw path helper.
- Add JiuwenClaw file/core-file read/list/write MVP.
- Add health panel entry.

Phase 3:

- Linggan-owned cron trigger into JiuwenClaw.
- Platform audit integration.
- WeChat file/media return through Linggan URLs.

Phase 4:

- Skill provider decision.
- Memory sync decision.
- Sandbox/K8S deployment proof.

## 13. Open Questions

- Does JiuwenClaw enterprise branch expose stable APIs for skill list/install, or should we treat skills as runtime-private first?
- Should `SOUL.md`, `USER.md`, and `MEMORY.md` be injected per request, synced to workspace files, or imported into JiuwenClaw memory manager?
- Is JiuwenClaw native cron mature enough for enterprise admin UX, or should Linggan cron remain the only scheduler?
- For K8S, will employee-agent share storage with JiuwenClaw pods, or must all file operations go through an API?
- What is the minimum sandbox profile that allows web search, docs/PPT generation, and file operations while blocking host/network reconnaissance?
