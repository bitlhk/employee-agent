# Page Audit: SchedulePageV2

## Scope

- Component: `client/src/components/pages/SchedulePageV2.tsx`
- Supporting styles: `client/src/index.css`
- Related contract: `docs/product/CRON_TASK_CENTER_PLAN_V3_ADDENDUM.md`
- Related UI contract: `docs/design/UI_STABILITY_CONTRACT.md`
- Goal: verify the provider-backed task list, inline actions, and banking-fy visual vocabulary after Sprint 2 cleanup.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/pages/SchedulePageV2.tsx --top=30
pnpm run check
pnpm run build:client
```

## User States Covered By Implementation

- Registry/provider-backed task list.
- Empty state.
- Loading state.
- Error state with retry.
- Inline actions:
  - run now.
  - preview next runs.
  - enable / disable.
  - delete.
- Manual create form.
- Delivery target selection through bound channels.
- Status pills for run state.

## Theme Verification

- Light theme: pending manual visual check.
- Dark theme: pending manual visual check.
- System theme: pending manual visual check.

Manual browser verification is still required before this page can be marked frozen.

## Feature Flag Coverage

- Legacy `?scheduleV2=0` fallback has been removed after quiet observation.
- `SchedulePageV2` is the default and only schedule page.
- Cron provider path is the first-class route; legacy RPC fallbacks and dual-emit compatibility fields have been removed.

## Changes

- Replaced legacy SchedulePage with SchedulePageV2.
- Consumes the OpenClawCronProvider path.
- Uses new schedule shape (`cron | once | interval`) and delivery targets.
- Run-now uses backend watcher / delivery dedupe.
- Delete cleans delivery config.
- UI hardcoded values moved to CSS/token classes.

## Audit Data

After measured:

| Metric | Count |
|---|---:|
| hex | 0 |
| rgb/rgba | 0 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 0 |
| nav-emoji | 0 |

## Allowed Exceptions

None.

## Regression Checklist

- Task list renders current OpenClaw provider jobs: pending browser check.
- Run-now shows immediate toast and later sends channel notification: pending browser check.
- Preview expands five future runs: pending browser check.
- Enable / disable persists after reload: pending browser check.
- Delete removes the row and delivery config: pending browser check.
- Manual create path creates a provider job and delivery config: pending browser check.
- Unbound channel submit is blocked with a useful message: pending browser check.
- Light/dark/system readability: pending browser check.

## Freeze Status

- Status: audit-passed, visual-pending.
- Date: 2026-05-01.
- Owner: Hongkun (implementation: GPT, review: Claude / Codex).
