# Page Audit: ManusDialog

## Scope

- Component: `client/src/components/ManusDialog.tsx`
- Type: centered login dialog component.
- Goal: validate `banking-tokens.css` and the page-audit workflow before larger pages such as `SettingsPage` and `SchedulePage`.
- Related plan: `docs/product/BANKING_UI_RESTYLE_PLAN.md` section 4.6, modal/dialog vocabulary.
- Related contract: `docs/design/UI_STABILITY_CONTRACT.md` section 6, page audit workflow.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/ManusDialog.tsx --top=10
pnpm run build:client
```

## User States

- Default: dialog opens with logo, title, description, and login button.
- Empty: missing `logo` or `title` hides the corresponding visual block.
- Loading: not owned by this component; handled by caller through `onLogin`.
- Error: not owned by this component; handled by caller.
- Confirm/delete: N/A.

## Theme Verification

- Light theme: pending manual visual check.
- Dark theme: pending manual visual check.
- System theme: pending manual visual check.

## Feature Flag Coverage

- `chatv2=on`: N/A, component does not depend on chat transport.
- `chatv2=off`: N/A, component does not depend on chat transport.
- Other `VITE_*` / localStorage flags: N/A.

## Changes

- Added `client/src/styles/banking-tokens.css` as the first banking-fy token surface.
- Replaced dialog background, text, border, shadow, radius, and primary button color with `--banking-*` tokens.
- Kept Lingxia red as the primary action and brand anchor.
- Preserved the existing shadcn and `--oc-*` theme systems during the transition period.

## Audit Data

Before:

| Metric | Count |
|---|---:|
| hex | 5 |
| rgb/rgba | 2 |
| tw-hardcode | 2 |
| tw-status | 0 |
| inline-risk | 0 |

After measured:

| Metric | Count |
|---|---:|
| hex | 0 |
| rgb/rgba | 0 |
| tw-hardcode | 0 |
| tw-status | 0 |
| inline-risk | 0 |

## Allowed Exceptions

| File | Line | Reason | Follow-up |
|---|---:|---|---|
| None | - | - | - |

## Regression Checklist

- Component can open: pending caller-page visual check.
- Login button is clickable: pending caller-page visual check.
- Light theme readable: pending manual visual check.
- Dark theme readable: pending manual visual check.
- No console error: pending manual visual check.

## Freeze Status

- Status: audit-passed, visual-pending.
- Date: 2026-04-30.
- Owner: Hongkun (implementation: GPT, review: Claude).
