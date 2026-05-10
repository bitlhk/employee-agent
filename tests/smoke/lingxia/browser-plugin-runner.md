# Lingxia Browser Plugin Runner

This smoke suite is intentionally adapter-based:

- `lingxia-smoke-runner.mjs` contains product smoke cases.
- `playwright-runner.mjs` runs those cases with standard Playwright.
- Browser plugins such as Codex IAB or Claude Code Chrome can run the same cases by passing their current browser `tab` object into `runSmokeV1`.

## IAB / Browser-Use Shape

When the browser plugin exposes a `tab` object with `tab.goto`, `tab.url`, `tab.playwright.*`, and `tab.dev.logs`, use:

```js
const { runSmokeV1 } = await import("./tests/smoke/lingxia/lingxia-smoke-runner.mjs");

const result = await runSmokeV1({
  tab,
  baseUrl: "http://127.0.0.1:15180",
  adoptId: "lgc-ofnmjm4joj",
  runId: `SMOKE-V1-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
});

console.log(result.markdown);
```

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
