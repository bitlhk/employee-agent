# Page Audit: SkillsPage

## Scope

- Component: `client/src/components/pages/SkillsPage.tsx`
- Related bridge: `client/src/components/pages/MarketplacePage.tsx`
- Supporting styles: `client/src/index.css`
- Related contract: `docs/design/SKILL_STORAGE_CONTRACT.md`
- Related UI contract: `docs/design/UI_STABILITY_CONTRACT.md` section 6, page audit workflow.
- Goal: verify the registry-backed Skills page after Phase 3 storage/install/reconcile work.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/pages/SkillsPage.tsx --top=30
pnpm run check
pnpm run build:client
node scripts/backfill-skill-scan.ts --summary-only   # optional, if scan baseline needs rechecking
```

## Data Baseline

- Registry rows: 41.
- Runtime state: 41 ready.
- Scan coverage: 41 / 41 entries have scan metadata.
- Scan warnings: 1 entry has warning metadata.
- Warning entry observed on 2026-05-01:
  - `lgc-mynpzbbfqm / skill-vetter / uploaded`
  - warning: `skill-vetter/SKILL.md: eval()`
- Interpretation: acceptable audit warning; it is surfaced through SkillsPage advanced information and should remain visible for administrator review.

## User States Covered By Implementation

- Registry-backed list view.
- Source filters: all, builtin, marketplace, uploaded, generated.
- State filters: all, ready, attention, disabled.
- Detail drawer.
- Advanced information drawer section.
- Upload dialog.
- Reconcile action.
- Source-specific actions:
  - builtin: enable / disable, reconcile.
  - marketplace: enable / disable, uninstall, reconcile.
  - uploaded / generated: enable / disable, rename, delete, reconcile.
- Marketplace uninstall semantics:
  - Marketplace uninstall removes the registry entry and runtime copy.
  - The source remains in the marketplace and can be installed again.
  - This differs from builtin disable, which keeps the registry row visible as a disabled platform capability.

## Theme Verification

- Light theme: manually verified on 2026-05-01.
- Dark theme: manually verified on 2026-05-01.
- System theme: manually verified on 2026-05-01.

Manual browser verification completed by Hongkun on 2026-05-01.

## Feature Flag Coverage

- `chatv2=on`: N/A for this page.
- `chatv2=off`: N/A for this page.
- Skill registry is now the first-class data source. No legacy package/runtime dual-source fallback is expected for the frozen path.

## Changes

- SkillsPage consumes the SkillRegistry view instead of legacy mixed package/runtime state.
- Runtime state and review state are rendered as semantic pills.
- Registry scan warnings are shown in the advanced information area.
- Source-specific actions follow the storage contract product semantics.
- Emoji icons were removed from the page source and replaced with lucide icons.
- Status, warning, and muted colors were moved from JSX inline styles to CSS classes.
- Marketplace tab received a UI bridge pass: emoji removed, category chips made one-line, `office` maps to `办公效率`, and card/search/empty states now use the SkillsPage visual vocabulary. Backend marketplace semantics are intentionally unchanged.
- Marketplace install/update/uninstall now use SkillRegistry-backed semantics. Installed state is derived from registry marketplace entries, update state compares marketplace version with installed version, and uninstall removes marketplace entries from `我的技能`.

## Audit Data

After measured for `SkillsPage.tsx`:

| Metric | Count |
|---|---:|
| hex | 0 |
| rgb/rgba | 0 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 0 |
| nav-emoji | 0 |

After measured for `MarketplacePage.tsx`:

| Metric | Count |
|---|---:|
| hex | 0 |
| rgb/rgba | 0 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 0 |
| nav-emoji | 0 |

## Allowed Exceptions

| Area | Reason | Follow-up |
|---|---|---|
| Hidden file input | `display: none` is interaction plumbing for the upload button, not visual styling. | Permanent allowed exception. |
| Alert icon layout | `flexShrink` / `marginTop` is minor icon alignment, not color or token styling. | Can be moved to CSS during the next cleanup pass, but it is not an inline-risk violation. |

## Regression Checklist

- `lgc-ofnmjm4joj` shows the expected registry-backed skills: verified.
- `lgc-mynpzbbfqm / skill-vetter` shows scan warning in advanced information: verified.
- Builtin skills do not show uninstall/delete actions: verified.
- Uploaded/generated skills show rename/delete actions with confirmation: verified.
- Reconcile action triggers backend reconcile and refreshes status: verified.
- Enabled toggle persists after reload: verified.
- Advanced information is collapsed by default and expands correctly: verified.
- DOM emoji count under `.skills-page` is 0: verified by audit script.
- Marketplace category chips stay one-line: verified.
- Marketplace search/filter/card states work: verified.
- Marketplace install creates a registry entry and the skill appears in `我的技能`: verified.
- Marketplace uninstall removes the skill from `我的技能` after refresh: verified.
- Marketplace reinstall after uninstall works: verified.
- Light/dark/system readability: verified.
- Upload dialog renders correctly: verified.

## Freeze Status

- Status: frozen.
- Date: 2026-05-01.
- Owner: Hongkun (implementation: GPT, review: Claude / Codex).
