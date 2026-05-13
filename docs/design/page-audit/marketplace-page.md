# Page Audit: MarketplacePage

## Scope

- Component: `client/src/components/pages/MarketplacePage.tsx`
- Parent surface: `client/src/components/pages/SkillsPage.tsx`, tab `技能市场`
- Supporting styles: `client/src/index.css`
- Related contract: `docs/design/SKILL_STORAGE_CONTRACT.md`
- Goal: verify the registry-backed marketplace install loop and align the tab with the SkillsPage visual vocabulary.

## Reproduce

```bash
pnpm tsx scripts/audit-ui-hardcodes.ts client/src/components/pages/MarketplacePage.tsx --top=30
pnpm run check
pnpm run build:client
pnpm exec vitest run server/_core/skills/skill-source.test.ts server/_core/skills/skill-registry.test.ts
```

## User States Covered By Implementation

- Marketplace hero / context notice.
- Category chips.
- Search field.
- Loading state.
- Empty state.
- Skill card grid.
- Install button and installing state.
- Installed state (`已安装`) driven by SkillRegistry marketplace entries.
- Update state (`更新`) when marketplace version differs from installed version.
- Detail dialog with install / update / uninstall actions.
- Uninstall removes the marketplace registry entry so the skill disappears from `我的技能`; marketplace source remains reinstallable.

## Theme Verification

- Light theme: manually verified on 2026-05-01.
- Dark theme: manually verified on 2026-05-01.
- System theme: manually verified on 2026-05-01.

Manual browser verification completed by Hongkun on 2026-05-01.

## Feature Flag Coverage

- `chatv2=on`: N/A.
- `chatv2=off`: N/A.
- Marketplace list remains on `claw.marketList`.
- Marketplace install now goes through SkillRegistry install / reconcile / scan persistence.
- Marketplace uninstall uses the registry uninstall endpoint and removes marketplace entries from `我的技能`.

## Changes

- Removed emoji category icons and replaced them with `lucide-react` icons.
- Added `office` category mapping to display as `办公效率`.
- Made category chips single-line and horizontally scrollable instead of wrapping icon/text onto separate lines.
- Replaced page-local inline visual styles with reusable CSS classes.
- Added registry-backed `安装 / 已安装 / 更新` states.
- Added detail dialog actions for install, update, and uninstall.
- Removed nested interactive button markup from market cards; cards now use `role="button"` with keyboard activation.
- Marketplace uninstall now removes registry entries instead of leaving disabled marketplace rows in `我的技能`.

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

- Category chips stay one-line at normal desktop width: verified.
- Category filtering works: verified.
- Search works: verified.
- Empty state renders without emoji: verified.
- Skill cards use consistent density with SkillsPage: verified.
- Install creates a SkillRegistry marketplace entry and shows `已安装`: verified.
- Installed skill appears in `我的技能`: verified.
- Detail dialog exposes uninstall for installed marketplace skills: verified.
- Uninstall removes the skill from `我的技能` after refresh and returns the card to installable state: verified.
- Reinstall after uninstall works: verified.
- Update state appears when market version differs from installed version: verified.
- Light/dark/system readability: verified.

## Freeze Status

- Status: frozen.
- Date: 2026-05-01.
- Owner: Hongkun (implementation: GPT, review: Claude / Codex).
