# Employee Agent Smoke Tests

This directory is the GitHub-safe home for Employee Agent smoke tests.

The suite is split into:

- `employee-agent-smoke-runner.mjs`: reusable product smoke cases.
- `playwright-runner.mjs`: standard Playwright CLI entry.
- `adapters/playwright-tab-adapter.mjs`: wraps a Playwright `page` into the tab shape used by the reusable runner.
- `browser-plugin-runner.md`: notes for Codex IAB and Claude Code Chrome plugin runs.
- `config.example.json`: non-secret sample config.
- `reports/`: generated local reports, ignored by Git.

## Coverage

Current `runSmokeV1` covers:

- L1 read-only navigation: chat, skills, channels, schedule, settings, memory, collaboration, workspace, docs.
- Marketplace / skill plaza read-only check.
- L2 safe chat write.
- Skill list chat query.
- Cron list chat query.
- Channel HTTP health check.
- Thinking-leak and duplicate-message checks.

Current `runSmokeV2` additionally covers reversible L3 flows:

- Complex multi-step dialogue.
- Schedule create / menu list / chat query / tenant isolation / delete.
- Generated skill create / registry visible / menu visible / destroy / cleanup.
- Generated artifact file create / workspace API visible / read / token download / workspace UI visible / cleanup.
- Concurrent two-window chat session isolation when the adapter supports opening a sibling tab. This still follows the product's existing `lingxia_web_conversation_<adoptId>` sessionStorage key and rejects shared chat history between sibling windows.

## Local Playwright Run

Install Playwright in your local environment:

```bash
npm install --no-save playwright
```

Run against an existing local tunnel:

```bash
SMOKE_BASE_URL=http://127.0.0.1:15180 \
SMOKE_ADOPT_ID=lgc-ofnmjm4joj \
SMOKE_SESSION_COOKIE='paste-session-cookie-here' \
node tests/smoke/employee-agent/playwright-runner.mjs
```

Run the fuller V2 suite:

```powershell
$env:SMOKE_LEVEL = "v2"
node tests/smoke/employee-agent/playwright-runner.mjs
```

On Windows PowerShell:

```powershell
$env:SMOKE_BASE_URL = "http://127.0.0.1:15180"
$env:SMOKE_ADOPT_ID = "lgc-ofnmjm4joj"
$env:SMOKE_SESSION_COOKIE = "<paste-session-cookie-here>"
node tests/smoke/employee-agent/playwright-runner.mjs
```

## Huawei Cloud Tunnel

For remote smoke through SSH tunnel:

```powershell
ssh -N -L 15180:127.0.0.1:5180 -i <private-key.pem> -o StrictHostKeyChecking=no <user>@<server-ip>
```

Then run the Playwright runner or a browser plugin against:

```text
http://127.0.0.1:15180/claw/<adoptId>
```

## Browser Plugins

Codex IAB and Claude Code Chrome should use the same `employee-agent-smoke-runner.mjs`.
See `browser-plugin-runner.md` for the adapter shape.

## Reports

Generated reports are written to `reports/` by default and must not be committed unless intentionally copied into a sanitized documentation snapshot.
