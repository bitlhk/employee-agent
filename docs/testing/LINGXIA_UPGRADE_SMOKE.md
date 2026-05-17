# Lingxia Upgrade Smoke Test

Date: 2026-05-01
Scope: Browser + backend smoke gate for OpenClaw upgrades and Lingxia runtime changes.

## Purpose

This smoke suite answers one question:

> After an OpenClaw or Lingxia runtime change, can a normal user still use the core product without trust-breaking regressions?

It is intentionally split into safe and destructive levels. Run safe levels every time. Run destructive levels only when explicitly approved because they can send messages, create tasks, install skills, or mutate user state.

## Current Browser Access Pattern

Codex Browser Use cannot reliably navigate the public HTTPS domain in this Windows session because the external-site safety check depends on a Codex app-server path that is currently unavailable.

Use a localhost SSH tunnel instead:

```powershell
ssh -N -L 15180:127.0.0.1:5180 -i D:\KeyPair-ECS.pem -o StrictHostKeyChecking=no root@123.60.154.110
```

Then open:

```text
http://127.0.0.1:15180/claw/lgc-ofnmjm4joj
```

## Test Levels

### L0 Backend Contract

Always run.

```bash
cd /root/linggan-platform
scripts/check-openclaw-upgrade-readiness.sh
```

Before production upgrade, run:

```bash
scripts/check-openclaw-upgrade-readiness.sh --full
```

Pass criteria:

- Runtime contract has 0 failures.
- Thinking leak check passes.
- Skill registry summary is healthy.
- Recent critical logs contain no active regression signal.

### L1 Browser Read-Only Navigation

Always run.

Pages:

- Chat
- Skills
- Marketplace
- Channels
- Schedule
- Settings
- Memory

Checks for every page:

- Page opens without console errors.
- Active nav item is correct.
- Main content exists.
- No `<think>`, `<thinking>`, raw reasoning, or "reasoning" leakage.
- No emoji in product/system UI where UI_STABILITY icon policy applies.
- No stuck loading state after waiting for network idle.

Page-specific checks:

| Page | Required signal |
|---|---|
| Chat | Input exists, send button exists, model selector visible |
| Skills | "My Skills" tab shows skill count and rows |
| Marketplace | Category chips and install/installed actions are visible |
| Channels | WeChat and Feishu status panels render |
| Schedule | Task table headers render: task, schedule, channel, next run, status, actions |
| Settings | Appearance section renders theme, mode, and radius controls |
| Memory | MEMORY.md appears and editor is visible |

### L2 Safe Write Smoke

Run on every upgrade candidate. This mutates chat history only.

Chat message:

```text
Smoke test：请只回复“OK”。
```

Pass criteria:

- User message appears exactly once.
- Assistant replies with `OK` or a semantically equivalent short response.
- Streaming completes and UI returns to idle state.
- No duplicate submission.
- No thinking leak.
- Console errors stay at 0.

### L3 Controlled Product Mutations

Run before production upgrade when explicitly approved.

These actions mutate product state but should be reversible.

#### Skills / Marketplace

Use a disposable or already-installed marketplace skill.

Checks:

- Install from Marketplace.
- Skill appears in My Skills as ready.
- Without refreshing the page, ask chat to use the skill if the skill has a safe prompt.
- Uninstall the skill.
- Skill disappears from My Skills after refresh.
- Reinstall is available in Marketplace.

Pass criteria:

- Registry state stays consistent.
- No duplicate registry rows.
- Uninstall removes marketplace skill from My Skills.
- Hot-start works or the failure is recorded as a known OpenClaw cache limitation.

#### Schedule

Use a safe test cron job.

Checks:

- Create a disposable test schedule when a clean test target is available.
- Preview next runs.
- Run now.
- Confirm watcher starts.
- Confirm no duplicate delivery.

Pass criteria:

- Run-now starts once.
- Channel delivery fires once.
- Poller does not resend the same run.

#### Channels

Only run with approval because it sends real messages.

Checks:

- WeChat test send.
- Feishu test send.
- Do not unbind any channel in smoke tests.

Pass criteria:

- Test message arrives.
- No auth_failed or channel_unreachable logs.

#### Explicitly excluded from L3

- Unbind channel.
- Delete real user data.
- Delete non-disposable cron jobs.
- Delete user-uploaded skills unless the skill was created by the same smoke run.

### L4 Upgrade Regression Scenarios

Run only when the OpenClaw release notes touch Gateway, chat, sessions, cron, channels, memory, or skills.

Checks:

- WSS interruption / fallback does not duplicate a submitted user message.
- Recover flow restores assistant output after stream interruption.
- Memory page first-load refresh still shows fresh content.
- Settings dark mode switches sidebar/header/page container.
- Skill warning details still show in advanced info.

## Red Flags

Fail the upgrade if any appear:

- User message duplicates.
- Assistant references phantom prior answer.
- `<think>` or hidden reasoning leaks into visible content.
- Cron run sends duplicate channel notification.
- Marketplace uninstall leaves a marketplace skill in My Skills.
- Skill install says ready but chat cannot use it after a reasonable refresh/reconnect.
- Channel test send fails after being previously healthy.
- Console errors on core pages.

## Backend Log Collection

Every smoke run should have a run id:

```text
SMOKE-YYYYMMDD-HHMMSS
```

Before browser actions, mark the run:

```bash
scripts/collect-lingxia-smoke-logs.sh start SMOKE-YYYYMMDD-HHMMSS
```

After browser actions, collect logs:

```bash
scripts/collect-lingxia-smoke-logs.sh finish SMOKE-YYYYMMDD-HHMMSS
```

The log bundle should include:

- OpenClaw readiness output.
- Recent PM2 logs.
- Critical grep for cron, chat dedup, channel send, skills registry, thinking leak, recover failures, and unsupported channel errors.
- A short pass/fail summary.

This gives each smoke run a front-end and back-end evidence pair.

## Current Baseline Snapshot

Last known baseline on OpenClaw `2026.4.26 (be8c246)`:

- L0 backend contract: pass.
- L1 read-only browser navigation: pass.
- L2 chat safe write: pass.
- Skills: 5 visible for `lgc-ofnmjm4joj`, 41 registry entries ready globally.
- Marketplace: 9 skills visible.
- Thinking leak: not observed.

## Recommended Upgrade Procedure

1. Run L0 on current production baseline.
2. Run L1 + L2 on current production baseline.
3. Upgrade staging or low-traffic production candidate.
4. Run L0 again.
5. Run L1 + L2 again.
6. If release notes touch risky areas, run L3/L4 with explicit approval.
7. If all pass, keep upgrade and observe 24h logs.
8. If any red flag appears, rollback OpenClaw and rerun L0/L1/L2.

## Automated Upgrade Gate

Use this shell gate when evaluating a new OpenClaw version. It captures a
pre-upgrade backend baseline, then compares the post-upgrade state against it.

Pre-upgrade:

```bash
cd /root/linggan-platform
scripts/run-openclaw-upgrade-smoke.sh pre --run-id=UPG-20260429 --full
```

Upgrade OpenClaw, restart Lingxia/OpenClaw as needed, then run:

```bash
cd /root/linggan-platform
scripts/run-openclaw-upgrade-smoke.sh post --run-id=UPG-20260429 --full
```

The script captures:

- OpenClaw version and binary path.
- Lingxia git revision.
- Runtime contract readiness.
- Cron orphan scan.
- Skill migration dry-run baseline.
- Skill registry state distribution.
- Recent critical PM2 logs.

Post-upgrade decision:

- `readiness`, `cron-orphans`, and `skill-migrate-dry-run` must exit 0.
- Skill registry state should not drift unexpectedly.
- Cron orphan and skill migration dry-run output should not introduce new
  required migrations.
- Critical logs should stay at 0 for active regressions.
- Browser release smoke must still pass after the backend gate.

This script is not a replacement for browser testing. It is the backend/data
gate for deciding whether the OpenClaw upgrade is safe enough to keep testing.

## Future Automation

The same matrix should be moved to a Playwright runner when we are ready to add the dependency. Until then, Codex Browser Use can run L1/L2 through the localhost SSH tunnel.

## Codex Browser Runner

Current reusable runner:

```text
C:\Users\Hongkun\Documents\lingxia-browser-smoke-runner.mjs
```

Archived copy:

```text
/root/linggan-platform/docs/testing/lingxia-browser-smoke-runner.mjs
```

Conversation command:

```text
跑 Lingxia Upgrade Smoke L0-L2
```

Expected behavior:

- Start a backend log collection window.
- Run backend readiness fast check.
- Open `http://127.0.0.1:15180/claw/lgc-ofnmjm4joj`.
- Run read-only browser navigation over Chat, Skills, Channels, Schedule, Settings, Memory.
- Run Marketplace read-only check.
- Send one unique safe chat prompt and verify no duplicate submission or thinking leak.
- Finish backend log collection and summarize critical lines.

The runner generates a unique chat smoke prompt every time, so prior smoke messages do not cause false duplicate-message failures.
