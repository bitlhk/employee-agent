# Agent Plaza Registry Rollout Runbook

Status: Phase 2.1 ready, production still on `legacy`.

This runbook controls the switch from the legacy `/api/claw/business-agents`
data path to the Agent Registry-backed path. The switch is intentionally
separate from the migration work: Phase 2.1 proves shape compatibility, while
Phase 2.2 decides whether to expose the registry path.

## Current Baseline

- Production endpoint source: `legacy`.
- Registry seed source: `/root/linggan-platform/server/_core/agent/data/agents.seed.json`.
- Comparison script: `/root/linggan-platform/scripts/compare-agent-plaza-source.ts`.
- Registry seed contains 10 definitions and 3 providers.
- All migrated definitions are tagged `runtime-inferred`.
- `task-stock` is additionally tagged `manual-review`.
- Internal migration notes must live under `metadata.migrationNote`; they must
  not be rendered in user-facing descriptions.

## Hard Gates

Do not flip `AGENT_PLAZA_DATA_SOURCE=registry` in production unless all gates pass:

1. No other high-risk release is in flight for chat, cron, collaboration, or skills.
2. A staging or short-window non-production instance can be watched for at least 2 hours.
3. `compare-agent-plaza-source.ts` passes with count 10 vs 10.
4. No internal migration notes appear in the user-facing `/api/claw/business-agents` payload.
5. The rollback command has been tested or is operationally ready.

## Preflight: Read-Only Comparison

Run this on the server without changing production flags:

```bash
cd /root/linggan-platform
pnpm tsx scripts/compare-agent-plaza-source.ts
```

Expected:

```text
[AGENT-PLAZA-COMPARE] legacy count=10
[AGENT-PLAZA-COMPARE] registry count=10
[AGENT-PLAZA-COMPARE] live source=legacy
[AGENT-PLAZA-COMPARE] PASS: normalized legacy and registry lists match
```

This script is the release gate for Phase 2.2. It exits non-zero if:

- the live endpoint is no longer `source=legacy` before the planned flip;
- legacy or registry count differs from `AGENT_PLAZA_EXPECT_COUNT` (default 10);
- user-facing fields differ after normalization;
- internal migration text such as `migrationNote`, `runtime-inferred`, or
  `manual-review` leaks into the live or adapter-shaped payload.

Also verify production is still legacy:

```bash
curl -fsS http://127.0.0.1:5180/api/claw/business-agents \
  | jq '{source,count:(.agents|length),ids:[.agents[].id]}'
```

Expected:

```json
{ "source": "legacy", "count": 10 }
```

## Staging / Short-Window Trial

Prefer a staging process. If no staging process exists, use a short operational
window only when the product owner is watching the Agent Plaza page.

Set:

```bash
export AGENT_PLAZA_DATA_SOURCE=registry
pm2 restart linggan-claw --update-env
```

Then verify:

```bash
curl -fsS http://127.0.0.1:5180/api/claw/business-agents \
  | jq '{source,count:(.agents|length),ids:[.agents[].id]}'
```

Expected:

```json
{ "source": "registry", "count": 10 }
```

Browser checks:

- Agent Plaza opens without console errors.
- The same 10 agents are visible.
- Names, icons, descriptions, and ordering match the legacy page unless a
  difference is explicitly documented.
- No text like `runtime-inferred`, `migrationNote`, `verify before dispatch`,
  or `manual-review` appears in the user-facing card/detail UI.

## Red-Light Differences

Stop and rollback immediately if any of these appear:

- Count differs from 10.
- Agent names differ unexpectedly.
- Icons are missing or converted incorrectly.
- `enabled` visibility differs.
- User-facing payload or UI exposes migration/internal notes.
- Agent Plaza 5xx rate increases.
- Users report an agent disappeared.

Allowed differences:

- Additional registry-only metadata fields that the legacy UI does not consume.
- Explicitly documented sort-order differences, if accepted by product.

## Rollback

Unset the flag or restore legacy:

```bash
unset AGENT_PLAZA_DATA_SOURCE
pm2 restart linggan-claw --update-env
```

Verify:

```bash
curl -fsS http://127.0.0.1:5180/api/claw/business-agents \
  | jq '{source,count:(.agents|length)}'
```

Expected:

```json
{ "source": "legacy", "count": 10 }
```

## Production Observation Window

After a successful registry trial, keep a 48h observation window before deleting
legacy code.

Watch:

- `/api/claw/business-agents` 5xx rate.
- Agent Plaza page load latency.
- Support/admin feedback: "my agent disappeared", "description changed", or
  "icon changed".
- Any logs related to `AGENT_PLAZA_DATA_SOURCE`, `AgentRegistry`, or JSON seed
  parsing.

## Phase 2.5 Legacy Removal Criteria

Only remove legacy after:

1. Production has served `source=registry` for 48h without incidents.
2. The comparison script still passes.
3. No internal migration metadata is visible to end users.
4. Dispatch wiring has not yet assumed inferred runtime mappings as truth.

Then remove:

- Legacy branch in `/api/claw/business-agents`.
- `AGENT_PLAZA_DATA_SOURCE` flag.
- Dead legacy collab-agent data path, if no other route consumes it.

Do not remove `metadata.migrationNote` or `runtime-inferred` tags until Phase 4
dispatch has verified each provider/runtime mapping.
