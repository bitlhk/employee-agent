# OpenClaw Upgrade Runbook

Date: 2026-05-01
Owner: Hongkun
Scope: Lingxia integration with OpenClaw Gateway / runtime.

## Current Baseline

- Production OpenClaw: `2026.4.26 (be8c246)`.
- Lingxia depends on OpenClaw through Gateway/runtime contracts for chat, cron, skills, trajectory recovery, and tool execution.
- Lingxia also carries a local thinking/reasoning leak patch expectation: model reasoning must not leak into user-visible assistant content.

## Goal

When OpenClaw publishes a new version, decide quickly and safely:

1. Whether the version is worth testing.
2. Whether it is safe to upgrade production.
3. What must be verified before and after the upgrade.
4. How to roll back if a contract breaks.

## Release Decision Rules

### Green Candidate

Stable patch/minor releases can enter staging evaluation.

Examples:
- `2026.4.27`
- Stable releases that mainly contain bug fixes or provider additions.

Requirements:
- Read release notes.
- Run Lingxia readiness checks.
- Pass staging smoke tests.

### Yellow Candidate

Stable releases touching high-risk areas need extra review before production:

- Gateway / sessions / chat events.
- OpenAI-compatible SSE or WSS protocol behavior.
- Trajectory / recovery files.
- Cron runtime / cron schema / run history.
- Skills loading, runtime skill paths, or marketplace behavior.
- Thinking/reasoning event handling.

Requirements:
- Run full contract checks.
- Run manual E2E flows.
- Keep rollback package ready.

### Red Candidate

Do not upgrade production directly:

- Beta / pre-release versions, for example `2026.4.29-beta.*`.
- Versions that change Gateway protocol without compatibility notes.
- Versions that fail thinking leak checks.
- Versions that fail cron, chat, skills, or channel delivery contracts.

Use only for local/staging investigation unless the release fixes a production blocker.

## Required Pre-Upgrade Checks

Run from `/root/linggan-platform`.

Fast check:

```bash
scripts/check-openclaw-upgrade-readiness.sh
```

Full check:

```bash
scripts/check-openclaw-upgrade-readiness.sh --full
```

Manual contract commands if needed:

```bash
pnpm tsx scripts/check-openclaw-runtime-contract.ts
pnpm tsx scripts/check-openclaw-runtime-contract.ts --full --agent trial_lgc-ofnmjm4joj
pnpm tsx scripts/check-openclaw-runtime-contract.ts --http --agent trial_lgc-ofnmjm4joj
```

Before upgrading, record:

```bash
openclaw --version
which openclaw
readlink -f "$(which openclaw)"
```

## Required Manual E2E Checks

After staging upgrade, verify:

1. Chat WSS path:
   - Send a normal message.
   - Confirm assistant response streams and completes.

2. HTTP fallback / recovery:
   - Simulate WSS interruption if possible.
   - Confirm no duplicate user message and no phantom "above answer" behavior.

3. Thinking leak:
   - Ask a question likely to trigger reasoning.
   - Confirm no `<think>`, `<thinking>`, raw reasoning, or hidden thought text appears in final assistant content.

4. Cron:
   - List jobs.
   - Preview runs.
   - Run one safe manual job.
   - Confirm ChannelProvider delivery to WeChat or Feishu.

5. Channels:
   - WeChat test send.
   - Feishu test send if configured.

6. Skills:
   - Install one marketplace skill.
   - Confirm it appears in My Skills.
   - Confirm hot-start behavior: without refreshing the page, try to use the installed skill in chat.
   - Uninstall and confirm it disappears from My Skills.

7. Trajectory recovery:
   - Confirm recover-status still returns assistant text for recently completed sessions.

## Thinking Patch Gate

This is a hard gate.

Fail production upgrade if any of these appear in user-visible content:

- `<think>`
- `<thinking>`
- raw hidden reasoning text
- tool/internal reasoning traces not intended for the user

The runtime contract check includes thinking leak detection. If it fails:

1. Stop upgrade.
2. Re-apply or adapt the thinking patch.
3. Re-run full checks.
4. Only proceed when the leak check is clean.

## Production Upgrade Steps

1. Pick a low-traffic window.
2. Back up OpenClaw install and Lingxia state.
3. Upgrade staging first.
4. Run fast + full readiness checks.
5. Run manual E2E checks.
6. If green, upgrade production.
7. Restart services.
8. Run fast readiness check again.
9. Observe logs for at least 60 minutes.

## Rollback

Rollback immediately if:

- Runtime contract check fails.
- Thinking leak appears.
- Cron delivery breaks.
- Chat duplicate submission reappears.
- Skill install/uninstall breaks.
- Gateway session protocol breaks.

Rollback sequence:

```bash
# Stop affected services.
pm2 stop linggan-claw

# Restore backed-up OpenClaw install or package.
# Then restart OpenClaw/Gateway as appropriate.

pm2 restart linggan-claw --update-env

# Verify.
scripts/check-openclaw-upgrade-readiness.sh
```

## 24h Observation After Upgrade

Watch for:

```bash
grep -E "CRON-LEGACY|CRON-RUNS-LEGACY|using legacy notify fallback|Unsupported channel|CRON-ORPHAN|CHAT-DEDUP|VERSION-DOWNGRADE|thinking|<think|recover.*failed|send failed|sync_failed|ERROR|Error" \
  /root/.pm2/logs/linggan-claw-*.log
```

Expected:

- No legacy cron fallback.
- No unsupported channel errors.
- No thinking leak.
- No unexpected skill registry downgrade warnings.
- No repeated chat dedup hits beyond rare network fallback cases.

## Decision Outcomes

### Upgrade

Allowed when:

- Fast and full checks pass.
- Manual E2E passes.
- Thinking patch gate passes.
- No high-risk release note conflicts remain.

### Hold

Use when:

- Minor warnings appear but no production contract is broken.
- Manual E2E has unresolved UX concerns.
- Release is stable but touches Gateway/session/cron/skills internals.

### Reject / Roll Back

Required when:

- Any runtime contract fails.
- Any thinking leak appears.
- Cron, skills, channel, or chat trust flows fail.
- Gateway behavior diverges from Lingxia assumptions.

## Future Improvement

If Lingxia becomes multi-instance, move in-memory gates such as chat in-flight dedup to Redis or another shared store before relying on upgrade checks in clustered deployment.
