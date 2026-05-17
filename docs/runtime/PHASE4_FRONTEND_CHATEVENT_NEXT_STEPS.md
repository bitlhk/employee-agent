# Phase 4 Frontend ChatEvent Migration - Next Steps

Date: 2026-04-29

## Current State

Backend runtime-facing work is complete enough for production:

- HTTP chat path parses OpenClaw Gateway SSE through `normalizeHttpSseLine`.
- WS chat path parses OpenClaw Gateway events through `normalizeWsEvent`.
- HTTP and WS truncation recovery are enabled globally via `SSE_TRUNCATE_DETECT=on`.
- Runtime contract tests cover smoke, WS full, and HTTP full paths.

Frontend Phase 4 foundation is now added but not wired into the hot path:

- `shared/runtime/types.ts`
- `shared/runtime/chat-event.ts`
- `client/src/lib/chat-event-parser.ts`
- `client/src/lib/chat-transport.ts`
- `client/src/lib/http-chat-transport.ts`
- `client/src/lib/ws-chat-transport.ts`
- `server/_core/runtime/chat-event-parser.test.ts`

Verification passed:

```bash
pnpm run check
pnpm exec vitest run server/_core/runtime/chat-event-parser.test.ts
```

Important: `Home.tsx` has not been switched. Production behavior is unchanged.

## Goal

Move the frontend from two parallel chat parsers:

- `Home.tsx` WS raw handler
- `Home.tsx` HTTP SSE loop

to one unified frontend model:

```text
HTTP SSE / WS raw JSON
  -> ChatTransport
  -> ChatEvent
  -> useChat reducer
  -> existing lingxiaMsgs shape
  -> existing ChatMessage renderer
```

The user-visible UI should not change during the migration.

## Non-Goals

Do not do these in Phase 4:

- Do not change `ChatMessage.tsx` rendering.
- Do not change backend wire format.
- Do not remove the existing HTTP/WS fallback behavior until the new path has been observed.
- Do not replace `OpenClawWSClient`; wrap it because it already owns reconnect and raw-handler behavior.
- Do not make the browser connect directly to OpenClaw Runtime. Physical path remains Lingxia -> OpenClaw Gateway.

## Proposed Sequence

### 4.1 Add reducer tests around ChatEvent -> lingxiaMsgs

Create a pure reducer, not a hook yet:

```ts
applyChatEvent(state, event) => nextState
```

It should support the current `lingxiaMsgs` output shape:

- assistant delta append
- thinking/reasoning block updates
- tool start/result
- workspace files pseudo tool card
- agent team events
- `transport.truncated` recovery marker
- `transport.length_limit`
- `transport.error`
- `transport.stream_end`

Why first:

- This is the highest-risk logic currently duplicated in `Home.tsx`.
- Pure tests are cheap and do not touch UI.

Suggested files:

- `client/src/lib/chat-state-reducer.ts`
- `server/_core/runtime/chat-state-reducer.test.ts`

Acceptance:

- `pnpm run check` passes.
- Reducer tests cover at least:
  - delta append
  - thinking then delta marks thinking done
  - tool call start/result
  - workspace files
  - truncated marks the exact assistant message as recovering
  - length limit appends warning
  - error replaces empty assistant message

### 4.2 Implement `useChatTransport` or `useChat`

Build a hook that composes:

- `WsChatTransport`
- `HttpChatTransport`
- `parseWirePayloadToChatEvents`
- reducer from 4.1
- existing recover polling logic

The hook must output a shape compatible with current `Home.tsx` usage:

```ts
{
  messages,
  isStreaming,
  send,
  stop,
  reset,
  connStatus,
  activeToolName,
  activeToolElapsed,
  activeToolStep,
  activeToolTotal,
  activeToolLabel,
}
```

Important:

- Keep current WS-first, HTTP-fallback semantics.
- Hermes (`lgh-*`) should still skip WS and go HTTP.
- Existing stale-stream guard semantics must be preserved.
- Existing recover polling must use stable message id, not `findLastIndex` after async work.

Suggested file:

- `client/src/hooks/useLingxiaChat.ts`

Acceptance:

- `pnpm run check` passes.
- Hook-level tests can be minimal if browser APIs are hard to mock; reducer tests are the main safety net.

### 4.3 Add a shadow/dev page before touching `Home.tsx`

Add a hidden/internal route that uses the new hook:

- `/debug/chat-v2`
- Only accessible to admin/internal users, or just not linked from UI.

Purpose:

- Exercise real browser + real auth + real `/api/claw/ws` + real `/api/claw/chat-stream`.
- Keep production Home untouched.

Acceptance:

- Send normal message through WS path.
- Force HTTP path by disabling WS or using Hermes runtime.
- Verify long message still recoverable.
- Verify localStorage persistence is compatible if enabled.

### 4.4 Feature flag in `Home.tsx`

Only after 4.1-4.3 are green:

Add a feature flag:

```text
VITE_USE_CHAT_EVENT_TRANSPORT=off | allowlist | on
```

Recommended behavior:

- `off`: current Home path.
- `allowlist`: userId allowlist uses new hook.
- `on`: all users use new hook.

Do not delete old code yet.

Acceptance:

- userId=2 allowlist sends 5 normal messages.
- HTTP and WS logs remain natural.
- No duplicate deltas.
- No duplicated tool cards.
- No recover false positives.

### 4.5 Remove old parser code only after observation

Wait at least 24-48 hours after allowlist/on.

Then remove:

- old WS raw handler logic in `Home.tsx`
- old HTTP SSE parser loop in `Home.tsx`
- dead local helper code that moved into reducer/hook

Acceptance:

- `Home.tsx` line count should drop materially.
- `pnpm run check` passes.
- `pnpm run build:client` passes.
- Contract `--all` still passes.

## Rollout Plan

Recommended rollout:

1. Land 4.1 reducer and tests.
2. Land 4.2 hook, no production usage.
3. Land 4.3 debug page, internal manual testing.
4. Land 4.4 allowlist for userId=2.
5. Expand allowlist to internal users.
6. Turn on globally.
7. Wait 24-48h.
8. Land 4.5 cleanup.

## Review Focus For Claude

Please review these points specifically:

1. Does `ChatEvent` cover every current `Home.tsx` wire shape?
2. Is the `RuntimeEvent` vs `TransportEvent` boundary clean?
3. Should `transport.done` and `transport.stream_end` remain separate?
4. Are `HttpChatTransport` and `WsChatTransport` safe as currently unused foundation code?
5. Does `WsChatTransport` correctly wrap `OpenClawWSClient`, or is there hidden lifecycle risk?
6. Is the proposed reducer-first sequence safer than implementing `useChat` directly?
7. What extra tests should be required before touching `Home.tsx`?

## Known Risks

### Risk 1: duplicate message mutations

If the new hook is wired while old handlers still run, deltas/tool cards may duplicate.

Mitigation:

- The feature-flag branch must be exclusive.
- Do not attach old `setRawHandler` and new `WsChatTransport` at the same time.

### Risk 2: recovering the wrong assistant message

Async recovery can complete after the user sends a new message.

Mitigation:

- Continue using stable message ids.
- Reducer should target `messageId`, not last assistant.

### Risk 3: WS reconnect lifecycle

`OpenClawWSClient` owns reconnect. A wrapper can accidentally hide state changes.

Mitigation:

- Keep wrapper thin.
- Do not replace reconnect behavior in Phase 4.
- Add manual tests for reconnect after page network toggle if possible.

### Risk 4: transport.done vs stream_end confusion

`[DONE]` is an SSE sentinel; `__stream_end` is Lingxia's semantic completion marker.

Mitigation:

- Keep `transport.done` separate from `transport.stream_end`.
- Reducer should treat either as terminal only when appropriate, but metrics/logging should distinguish them.

## Recommendation

Do not switch `Home.tsx` immediately.

Next best step:

```text
Implement 4.1 reducer + tests.
```

That captures the hardest duplicated frontend logic in a pure, reviewable, testable unit before we touch the main chat UI.

