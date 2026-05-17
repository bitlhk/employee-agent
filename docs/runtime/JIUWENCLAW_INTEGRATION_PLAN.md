# JiuwenClaw Integration Plan

**Status**: draft  
**Date**: 2026-05-14  
**Scope**: employee-agent + JiuwenClaw enterprise branch  
**Decision**: keep OpenClaw stable, freeze Hermes, build JiuwenClaw as the new enterprise runtime lane.

## 1. Target State

Runtime lanes:

| Prefix | Runtime | Target |
|---|---|---|
| `lgc-*` | OpenClaw | Keep stable, no behavior change |
| `lgj-*` | JiuwenClaw | New enterprise runtime path |
| `lgh-*` | Hermes | Frozen compatibility only; no new capability work |

Transport:

- OpenClaw keeps existing WSS path.
- JiuwenClaw uses employee-agent HTTP SSE publicly, with backend-to-AgentServer WebSocket internally.
- Do not expose JiuwenClaw AgentServer directly to browsers or public networks.

Ownership:

- Linggan keeps identity, admin, billing, audit, channels, public URLs, and customer-facing APIs.
- JiuwenClaw owns reasoning, workspace execution, session state, native memory/tools, and sandboxed execution.

## 2. Rollout Rule

Use Shanghai as development and integration validation.

Recommended flow:

1. Develop and validate in Shanghai branch `feat/jiuwenclaw-runtime-mvp`.
2. Do not change OpenClaw `lgc-*` behavior while JiuwenClaw is being built.
3. Sync reviewed changes to Singapore OSS baseline.
4. Push sanitized code to GitHub from OSS.
5. Pull GitHub into Singapore runtime for user-facing verification.
6. After Singapore verification passes, decide whether Shanghai production service should restart.

## 3. Phase 0: Baseline

Status: started.

Already done:

- Added explicit `lgj-*` JiuwenClaw chat lane.
- Preserved `lgc-*` OpenClaw and `lgh-*` Hermes behavior.
- Added JiuwenClaw bridge from employee-agent to AgentServer E2A WebSocket.
- Kept frontend JiuwenClaw path on HTTP SSE.
- Created test agent `lgj-lihongkun`.
- Verified Shanghai JiuwenClaw direct chat smoke.

Exit criteria:

- `lgc-*` chat still uses OpenClaw WSS.
- `lgj-*` chat returns streamed assistant text through Linggan SSE.
- JiuwenClaw internal events do not leak confusing system noise into normal chat.
- TypeScript compile passes.

## 4. Phase 1: Sandbox First

Goal: prove JiuwenClaw can run hostile user workloads without host access.

Shanghai status on 2026-05-14:

- JiuwenBox service enabled as `jiuwenbox.service`.
- JiuwenBox listens only on `127.0.0.1:8321`.
- JiuwenClaw config includes `sandbox.url=http://127.0.0.1:8321` and `sandbox.type=jiuwenbox`.
- JiuwenClaw `lgj-lihongkun` created a JiuwenBox sandbox and executed `pwd` through it.
- Sandbox filesystem validation passed: `/etc/shadow` and host `/root` are not visible.
- Workspace initialization writes under virtual `/root/.jiuwenclaw/...` now succeed.
- Network validation is partially blocked: `network.mode=isolated` blocks cloud metadata, but also blocks direct DNS/public web access. Web search needs a controlled search proxy/tool path or JiuwenBox network NAT/ACL work before broad rollout.

Tasks:

- Start JiuwenBox on Shanghai, preferably bound to localhost or private network.
- Add JiuwenClaw config:

```yaml
sandbox:
  url: "http://127.0.0.1:8321"
  type: "<verified launcher type>"
```

- Confirm `interface_deep.py` selects `OperationMode.SANDBOX`, not `OperationMode.LOCAL`.
- Create a hardened JiuwenBox policy for Linggan use:
  - workspace read/write only under the tenant sandbox workspace
  - system paths read-only
  - block host metadata IP `169.254.169.254`
  - block SSH/lateral movement ports
  - inbound default deny
  - outbound web search allowed on `80/443`
  - no broad host bind mount such as `/root`, `/home`, or full `.jiuwenclaw`

Validation cases:

- Normal: web search, write markdown/doc/svg, create PPT/Word-like artifacts if tools support it.
- File safety: cannot read `/root/.ssh`, `/etc/shadow`, employee-agent `.env`, or other agents' workspaces.
- Network safety: cannot reach cloud metadata, SSH ports, or internal service ports except explicitly allowed ones.
- Process safety: `ps`, `netstat`, and similar commands show only sandbox-visible context or are blocked by policy.

Exit criteria:

- Sandbox mode is verified by logs and behavior, not just config presence.
- Basic customer tasks still work.
- Host reconnaissance attempts fail without crashing the agent.
- Direct web search behavior is explicitly decided: either through sandbox egress NAT/ACL, or through a Linggan-owned search proxy outside arbitrary shell/network access.

## 5. Phase 2: Runtime Health And Transport

Goal: make JiuwenClaw operationally visible in Linggan.

Tasks:

- Add `/health` details for JiuwenClaw AgentServer and Gateway.
- Add runtime status line for `lgj-*` agents in admin health panel.
- Add timeout, retry, and clearer error mapping in `jiuwenclaw-bridge.ts`.
- Filter internal JiuwenClaw events from user display while retaining them in logs/audit.
- Keep SSE as public Linggan chat contract.

Exit criteria:

- Admin can distinguish OpenClaw, Hermes, and JiuwenClaw runtime state.
- JiuwenClaw down/unreachable shows a clear platform error.
- User chat UI does not show raw E2A/internal event names.

## 6. Phase 3: Workspace, Files, Core Files, Memory

Goal: give `lgj-*` users the same visible file and profile experience as `lgc-*`.

Tasks:

- Add `jiuwenclaw-paths.ts`.
- Add `jiuwenclaw-files.ts` provider:
  - list/read/download/upload/delete under tenant workspace only
  - reuse Linggan file limits and extension restrictions
  - never expose raw absolute runtime paths
  - audit upload/delete/download
- Add core-file compatibility:
  - `AGENTS.md`
  - `SOUL.md`
  - `TOOLS.md`
  - `MEMORY.md`
  - `IDENTITY.md`
  - `HEARTBEAT.md`
  - `USER.md`
- Keep protected core files visible/editable where appropriate, but not deletable.
- Decide memory sync direction:
  - Phase 1: workspace-file compatibility
  - Later: explicit sync into JiuwenClaw memory manager if needed

Exit criteria:

- User can view, edit, and preserve core files for `lgj-*`.
- Agent cannot accidentally delete protected core files.
- WeChat-generated files/media are converted to Linggan public/signed URLs, not absolute paths.

## 7. Phase 4: Channels And Scheduled Tasks

Goal: preserve Linggan channel behavior while JiuwenClaw handles reasoning.

Channels:

- Keep Web, WeChat, WeCom, DingTalk, and Feishu entry through employee-agent.
- employee-agent maps channel and conversation id into JiuwenClaw `session_id`.
- employee-agent owns attachment ingestion and media delivery.

Scheduled tasks:

- Keep Linggan cron as source of truth for `lgj-*`.
- On trigger, call JiuwenClaw `chat.send` with `channel="cron"` and deterministic `session_id`.
- Keep delivery through Linggan channel adapters.
- Only evaluate JiuwenClaw native cron later for tasks created inside JiuwenClaw itself.

Exit criteria:

- WeChat and web conversations share the expected session behavior.
- Scheduled task runs are visible in Linggan admin/audit.
- Runtime failures do not silently drop channel delivery.

## 8. Phase 5: Skills

Goal: avoid forcing Linggan's old skill market model onto JiuwenClaw too early.

Tasks:

- Show JiuwenClaw skills as runtime-managed/read-only at first.
- Disable Linggan skill install/uninstall for `lgj-*` until JiuwenClaw install semantics are verified.
- Evaluate JiuwenClaw `skilldev` separately as a native capability.
- If stable file/API semantics exist, add `jiuwenclaw-skills.ts` provider later.

Exit criteria:

- Admin UI does not imply unsupported skill install actions for `lgj-*`.
- Existing OpenClaw skill market remains unchanged for `lgc-*`.

## 9. Phase 6: Audit, Tests, And Release Gates

Required tests before Singapore verification:

- TypeScript compile.
- `lgc-*` OpenClaw smoke.
- `lgj-*` JiuwenClaw chat smoke.
- JiuwenClaw sandbox hostile command smoke.
- File/core-file CRUD smoke.
- WeChat media/file delivery smoke.
- Cron trigger smoke.

Audit requirements:

- Chat request metadata includes runtime, adoptId, agentId, channel, conversation/session id.
- File operations are audited.
- Cron runs are audited.
- Sandbox failures are logged as security-relevant events.

Release gates:

- Do not roll JiuwenClaw to general users before sandbox mode is verified.
- Do not remove Hermes until JiuwenClaw covers chat, files, core files/memory, cron, channel delivery, and health.
- Do not expose JiuwenClaw AgentServer publicly.

## 10. Hermes Cleanup Policy

Short term:

- Keep Hermes code path for existing `lgh-*` data.
- Hide or disable new Hermes creation.
- Do not add new Hermes features.

Deletion condition:

- No active `lgh-*` customer agents, or explicit migration path exists.
- JiuwenClaw has passed the release gates above.
- A separate cleanup change removes Hermes routes/providers/tests in one controlled pass.

## 11. Immediate Next Steps

1. Enable JiuwenBox sandbox on Shanghai and verify JiuwenClaw enters `OperationMode.SANDBOX`.
2. Add JiuwenClaw health details and bridge hardening in employee-agent.
3. Add JiuwenClaw files/core-files provider.
4. Run web + WeChat smoke with `lgj-lihongkun`.
5. Sync Shanghai changes through Singapore OSS and GitHub after the first working slice passes.
