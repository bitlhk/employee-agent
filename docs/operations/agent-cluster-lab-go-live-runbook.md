# Agent Cluster Lab Go-Live Runbook

Status: draft for Phase 4.1.6 controlled lab
Last updated: 2026-05-03

## Purpose

This runbook describes how to enable the admin-only Agent Cluster Lab for a single allowlisted user, run the first real AWS Hermes / Claude Code dispatch tests, verify redaction, and shut the lab down quickly if anything looks wrong.

The lab is not a customer-facing feature. It must not be enabled for general users.

## Preconditions

- Agent code is committed and deployed from a known revision.
- `/api/claw/business-agents` still returns `source: "legacy"` unless an explicit Agent Plaza registry rollout is in progress.
- `pnpm vitest run server/_core/agent/__tests__` passes.
- `pnpm run check` passes.
- `pnpm tsx scripts/compare-agent-plaza-source.ts` passes.
- `business_agents` has the expected baseline: 12 rows, 10 enabled.
- AWS Hermes auth is fresh enough to run a short `/v1/runs` request. If Hermes
  returns `Codex refresh token was already consumed by another client`, treat it
  as an AWS runtime credential issue, not a Lingxia cluster-runner bug. Re-run
  the interactive Codex/Hermes authentication flow on the AWS host before
  testing Hermes-backed agents again.
- Kill file is absent before starting:

```bash
rm -f /tmp/lingxia-agent-cluster-lab.disabled
```

## Safety Model

The lab has three gates:

- `AGENT_CLUSTER_LAB_ENABLED=true`
- `AGENT_CLUSTER_LAB_ALLOW_USER_IDS=<admin-user-id>`
- kill file must not exist: `/tmp/lingxia-agent-cluster-lab.disabled`

The kill file is checked on every request and takes precedence over the env flag. It stops new requests immediately, but it does not cancel already in-flight provider requests. In-flight requests may continue until their provider timeout.

Emergency disable:

```bash
touch /tmp/lingxia-agent-cluster-lab.disabled
```

Full disable:

```bash
touch /tmp/lingxia-agent-cluster-lab.disabled
AGENT_CLUSTER_LAB_ENABLED=false pm2 restart linggan-claw --update-env
```

## Enable For One User

Replace `<ADMIN_USER_ID>` with the allowlisted admin user id.

```bash
rm -f /tmp/lingxia-agent-cluster-lab.disabled
AGENT_CLUSTER_LAB_ENABLED=true \
AGENT_CLUSTER_LAB_ALLOW_USER_IDS=<ADMIN_USER_ID> \
AGENT_CLUSTER_LAB_MAX_AGENTS=3 \
pm2 restart linggan-claw --update-env
```

Confirm normal legacy paths remain unchanged:

```bash
curl -fsS https://ling-claw.demo.linggan.top/api/claw/business-agents | jq '.source'
# expected: "legacy"
```

## Test Payloads

Use the browser session cookie for the admin user, or run from an authenticated environment that includes the user session cookie.

### 1. Hermes Only

```bash
curl -fsS -X POST "https://ling-claw.demo.linggan.top/api/admin/agent-cluster-lab/run" \
  -H "content-type: application/json" \
  -H "cookie: <SESSION_COOKIE>" \
  -d '{
    "agentDefinitionIds": ["task-my-wealth"],
    "prompt": "请用三句话说明你能完成什么任务，不要生成文件。"
  }' | tee /tmp/agent-cluster-lab-hermes.json
```

Expected:

- HTTP 200
- `run.status` is `completed`, or `failed` with a provider error that does not leak secrets.
- If the failure says the Codex refresh token was consumed, stop Hermes testing
  and refresh AWS Hermes credentials before retrying.
- Response does not contain `apiToken`, `api_token`, `Bearer`, `authorization`, `127.0.0.1:8642`, or `3.16.70.167`.

### 2. Claude Code Only

```bash
curl -fsS -X POST "https://ling-claw.demo.linggan.top/api/admin/agent-cluster-lab/run" \
  -H "content-type: application/json" \
  -H "cookie: <SESSION_COOKIE>" \
  -d '{
    "agentDefinitionIds": ["task-ppt"],
    "prompt": "请用三句话说明你能完成什么任务，不要生成文件。"
  }' | tee /tmp/agent-cluster-lab-ppt.json
```

Expected:

- HTTP 200
- `run.status` is `completed` or `failed` with a provider error that does not leak secrets.
- `runtimeSnapshotJson.selected[0].transport.kind` is present.

### 3. Two-Agent Fan-Out

```bash
curl -fsS -X POST "https://ling-claw.demo.linggan.top/api/admin/agent-cluster-lab/run" \
  -H "content-type: application/json" \
  -H "cookie: <SESSION_COOKIE>" \
  -d '{
    "agentDefinitionIds": ["task-my-wealth", "task-ppt"],
    "prompt": "请分别说明你会如何帮助完成一份金融汇报，不要生成文件。"
  }' | tee /tmp/agent-cluster-lab-two-agent.json
```

Expected:

- HTTP 200
- `resultsJson` has two entries.
- If one provider fails, `run.status` may be `partial_success`; the successful result must still be present.

## Redaction Checks

Run immediately after each lab request:

```bash
grep -RiaE "Bearer|api_token|apiToken|authorization|LEGACY_.*AUTH|3\\.16\\.70\\.167|127\\.0\\.0\\.1:8642" \
  /tmp/agent-cluster-lab-*.json
# expected: no output
```

Check application logs for leaked secret-like tokens:

```bash
pm2 logs linggan-claw --lines 1000 --nostream | \
  grep -iaE "Bearer|api_token|apiToken|authorization|LEGACY_.*AUTH"
# expected: no output
```

Endpoint strings may appear in older unrelated logs. Any occurrence during the lab window must be manually inspected.

## Latency Baseline

Record wall-clock duration for each request:

- Hermes only
- Claude Code only
- Two-agent fan-out

Initial lab thresholds:

- `< 30s`: PASS
- `30s - 120s`: WARN
- `> 120s`: FAIL and stop expanding allowlist

## Rollback

Fast stop:

```bash
touch /tmp/lingxia-agent-cluster-lab.disabled
```

Full rollback:

```bash
touch /tmp/lingxia-agent-cluster-lab.disabled
AGENT_CLUSTER_LAB_ENABLED=false pm2 restart linggan-claw --update-env
```

Verify disabled:

```bash
curl -i -X POST "https://ling-claw.demo.linggan.top/api/admin/agent-cluster-lab/run" \
  -H "content-type: application/json" \
  -H "cookie: <SESSION_COOKIE>" \
  -d '{"agentDefinitionIds":["task-my-wealth"],"prompt":"ping"}'
# expected: 404
```

## Expansion Criteria

Do not expand beyond one admin user until all are true:

- No secret or internal endpoint leakage in response payloads.
- No secret leakage in logs.
- Kill switch tested once and returns 404 while kill file exists.
- Single Hermes, single Claude Code, and two-agent fan-out have been run at least once.
- `source: "legacy"` remains unchanged for `/api/claw/business-agents`.
- No user-facing complaints or unexpected CPU/network spikes during the lab window.
