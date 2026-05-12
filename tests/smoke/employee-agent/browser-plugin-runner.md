# Employee Agent Browser Plugin Runner

This smoke suite is intentionally adapter-based:

- `employee-agent-smoke-runner.mjs` contains product smoke cases.
- `playwright-runner.mjs` runs those cases with standard Playwright.
- Browser plugins such as Codex IAB or Claude Code Chrome can run the same cases by passing their current browser `tab` object into `runSmokeV1`.

## IAB / Browser-Use Shape

When the browser plugin exposes a `tab` object with `tab.goto`, `tab.url`, `tab.playwright.*`, and `tab.dev.logs`, use:

```js
const { runSmokeV1 } = await import("./tests/smoke/employee-agent/employee-agent-smoke-runner.mjs");

const result = await runSmokeV1({
  tab,
  baseUrl: "http://127.0.0.1:15180",
  adoptId: "lgc-ofnmjm4joj",
  runId: `SMOKE-V1-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
});

console.log(result.markdown);
```

For the fuller reversible side-effect suite, use `runSmokeV2`. It includes the V1 cases by default and adds:

- complex multi-step dialogue smoke;
- create/list/query/delete schedule lifecycle;
- schedule tenant-isolation check, including guarding against known host cron task names leaking into a child claw;
- generated skill create/list/destroy lifecycle;
- generated artifact create/list/read/download/delete lifecycle;
- concurrent two-window chat stream probe when the browser adapter can open a sibling tab;
- checks that the generated skill disappears from the skills menu, registry, and workspace surface after deletion.

```js
const { runSmokeV2 } = await import("./tests/smoke/employee-agent/employee-agent-smoke-runner.mjs");

const result = await runSmokeV2({
  tab,
  baseUrl: "http://127.0.0.1:15180",
  adoptId: "lgc-ofnmjm4joj",
  runId: `SMOKE-V2-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
  includeV1: true,
});

console.log(result.markdown);
```

On Windows Codex IAB, current Browser Use text input can fail with `ClipboardItem is not available`.
Before running `runSmokeV2`, callers may attach two optional helpers to the active `tab`:

- `tab.__iabInsertText(text)`: direct text insertion fallback, for example CDP `Input.insertText`.
- `tab.__fetchJson(path, options)`: same-origin authenticated fetch fallback, for example page-context `fetch`.
- `tab.__fetchText(path, options)`: same-origin authenticated text/binary-ish fetch fallback for artifact download checks.
- `tab.__newTab(url)`: optional sibling-tab opener for concurrent window stream checks.

The smoke runner uses these helpers only as fallbacks, so normal Playwright/Browser Use runs are unchanged.

## Claude Code Chrome Shape

If Claude Code Chrome controls a logged-in Chrome tab, open the target page first:

```text
http://127.0.0.1:15180/claw/lgc-ofnmjm4joj
```

Then run the same `runSmokeV1({ tab, ... })` call from the plugin environment. If the plugin only exposes standard Playwright, use `adapters/playwright-tab-adapter.mjs` to wrap the page.

## Authentication

Preferred modes:

- Logged-in browser profile for Chrome plugin runs.
- `SMOKE_SESSION_COOKIE` for headless Playwright runs.
- UI login can be added later, but should not require committing passwords or tokens.

Never commit session cookies, API keys, private keys, or real user reports.
