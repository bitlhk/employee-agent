# Page Audit: SettingsPage

## Scope

- Component: `client/src/components/pages/SettingsPage.tsx`
- Section: appearance-only Settings page.
- Goal: keep Settings focused on visual preferences and remove low-value chat/layout/notification configuration from this page.
- Related plan: `docs/product/BANKING_UI_RESTYLE_PLAN.md` section 5, SettingsPage first.
- Related contract: `docs/design/UI_STABILITY_CONTRACT.md` section 6, page audit workflow.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/pages/SettingsPage.tsx --top=30
pnpm run check
VITE_LINGXIA_CHAT_V2=on pnpm run build:client
```

## User States Covered

- Appearance title and description.
- Theme cards.
- Light/system/dark segmented mode control.
- Border radius range control and preview.

## Out Of Scope

- Notification and WeChat binding will be redesigned together in a dedicated notification surface.
- Chat/layout tuning was intentionally removed from Settings because the controls were low-value for normal users.

## Theme Verification

- Light theme: pending manual visual check.
- Dark theme: pending manual visual check.
- System theme: pending manual visual check.

## Feature Flag Coverage

- `chatv2=on`: N/A for this section.
- `chatv2=off`: N/A for this section.
- Other `VITE_*` / localStorage flags: settings theme mode still applies.

## Changes

- Moved SettingsPage shell, section title, SettingRow, theme grid, segmented control, and radius preview from inline JSX styles to CSS classes.
- Reduced SettingsPage to a single appearance-focused surface.
- Removed the unused chat, layout, notification, and WeChat binding blocks from this page.
- Removed component-local theme hex colors by moving theme swatches to `--banking-theme-*` tokens.
- Reused the Lingxia red brand anchor for active segmented controls and theme selection.
- Kept Settings iconography on `lucide-react` according to the Navigation Vocabulary / Icon Policy.

## Audit Data

Before:

| Metric | Count |
|---|---:|
| hex | 8 |
| rgb/rgba | 1 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 52 |
| nav-emoji | not measured |

After measured:

| Metric | Count |
|---|---:|
| hex | 0 |
| rgb/rgba | 0 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 0 |
| nav-emoji | 0 |

The page keeps one legitimate dynamic inline style for the radius preview;
the audit script does not count it as `inline-risk`, but it is documented below so the exception is explicit.

## Allowed Exceptions

| Area | Lines | Reason | Follow-up |
|---|---:|---|---|
| Appearance radius preview | L131-L136 | Technical exception: `borderRadius` is driven by slider state and should stay dynamic | Permanent allowed exception unless a CSS variable bridge is introduced |

## Regression Checklist

- Settings page opens: pending browser check.
- Theme card selection works: pending browser check.
- Theme mode segmented control works: pending browser check.
- Radius slider works: pending browser check.
- Light theme readable: pending browser check.
- Dark theme readable: pending browser check.
- No console error: pending browser check.

## Freeze Status

- Status: audit-passed, visual-pending.
- Date: 2026-04-30.
- Owner: Hongkun (implementation: GPT, review: Claude).
