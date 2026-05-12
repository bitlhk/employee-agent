# Page Audit: ChannelsPage

## Scope

- Component: `client/src/components/pages/ChannelsPage.tsx`
- Supporting hook: `client/src/hooks/useChannelBinding.ts`
- Supporting styles: `client/src/index.css`
- Related contract: `shared/types/cron.ts` channel provider interfaces.
- Related UI contract: `docs/design/UI_STABILITY_CONTRACT.md` section 13.4 master-detail exceptions.
- Goal: verify the channel binding master-detail surface after ChannelProvider and frontend adapter work.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/pages/ChannelsPage.tsx --top=30
pnpm run check
pnpm run build:client
```

## User States Covered By Implementation

- Channel list master-detail layout.
- WeChat scan binding.
- Feishu device-flow binding.
- WeCom placeholder.
- Bound state.
- Test send.
- Unbind.
- Unsupported state.

## Theme Verification

- Light theme: pending manual visual check.
- Dark theme: pending manual visual check.
- System theme: pending manual visual check.

Manual browser verification is still required before this page can be marked frozen.

## Feature Flag Coverage

- No runtime feature flag.
- Channel binding flows are live; WeCom remains a placeholder.

## Changes

- Channel binding moved out of Settings into a first-class page.
- Frontend channel operations go through the `useChannelBinding` adapter boundary.
- WeChat and Feishu share the same hook state machine.
- Master-detail layout uses the UI_STABILITY section 13.4 exception.
- Emoji icons were removed and replaced with channel assets / lucide system icons.

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

| Area | Reason | Follow-up |
|---|---|---|
| Master-detail left list | Allowed by UI_STABILITY section 13.4 because channel list is the primary data object, not a page section nav. | Permanent allowed exception. |
| WeCom placeholder | Product placeholder until official WeCom admin-config binding is implemented. | Replace with real provider when customer demand is confirmed. |

## Regression Checklist

- WeChat start-bind shows QR and poll status updates: pending browser check.
- WeChat test send succeeds after binding: pending browser check.
- Feishu start-bind shows QR / code fallback and poll status updates: pending browser check.
- Feishu test send succeeds after binding: pending browser check.
- Unbind returns the channel to unbound state: pending browser check.
- WeCom placeholder is visibly not actionable: pending browser check.
- Master-detail selected item has `aria-current`: pending browser check.
- Light/dark/system readability: pending browser check.

## Freeze Status

- Status: audit-passed, visual-pending.
- Date: 2026-05-01.
- Owner: Hongkun (implementation: GPT, review: Claude / Codex).
