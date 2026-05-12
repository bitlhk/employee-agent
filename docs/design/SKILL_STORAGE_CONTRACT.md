# Skill Storage Contract

Date: 2026-05-01
Status: Phase 0 contract.

## 1. Goal

Lingxia skill pages are an index view, not the source of truth. The source of
truth is the skill source folder plus Lingxia-owned metadata. OpenClaw only
executes a per-adopt runtime copy that Lingxia installs and reconciles.

This contract prevents four recurring problems:

- A user deletes a skill folder from the workspace but the skill page still
  shows it as usable.
- A skill is uploaded or generated in chat but OpenClaw cannot see it yet.
- Platform skills and user skills are mixed in one runtime directory with no
  ownership boundary.
- Delete/uninstall behavior differs by route instead of by product semantics.

## 2. Storage Layers

```txt
/lingxia/skill-catalog/<skillId>/              Platform built-in skill source.
/lingxia/marketplace/<skillId>/                Marketplace skill source cache.
/workspace/<adoptId>/skills/<skillId>/         User uploaded/generated source.
/openclaw-runtime/<adoptId>/skills/<skillId>/  Per-adopt runtime copy.
```

Implementation paths can vary by deployment, but these four logical roots must
remain distinct.

## 3. Source Of Truth

| Source kind | Source truth | Runtime truth |
|---|---|---|
| `builtin` | Lingxia platform catalog | Per-adopt runtime copy |
| `marketplace` | Lingxia marketplace cache | Per-adopt runtime copy |
| `uploaded` | User workspace folder | Per-adopt runtime copy |
| `generated` | User workspace folder | Per-adopt runtime copy |

The runtime copy is never the durable source. It can be deleted and rebuilt
from the source folder by `reconcileSkills`.

### 3.1 Built-in Source Reality (MVP)

The long-term target is for Lingxia to mirror platform built-in skills into
`/lingxia/skill-catalog/<skillId>/` and use that catalog as the durable source.
The current deployment predates that catalog: many platform skills are shipped
by OpenClaw and only exist in OpenClaw workspace/runtime skill folders.

For MVP migration, `builtin` registry entries may reference the discovered
OpenClaw skill folder directly as `source.sourcePath`. This is a deliberate
bridge, not the final storage shape. A later catalog-sync phase should mirror
approved built-ins into Lingxia-owned storage without changing the public
`SkillSource` type.

Runtime-only skills must never be auto-promoted wholesale. They can become
`builtin` entries only when their `skillId` is explicitly listed in the
Lingxia built-in allowlist. Non-allowlisted runtime-only skills remain hidden
from the Skills page and are reported by migration/reconcile tooling for manual
classification.

The allowlist is a platform-level configuration, not a per-adopt preference.
MVP stores it in `data/skill-builtin-allowlist.json` so private deployments can
customize the built-in set without editing migration code. The same allowlist
must be used for every adopt during migration.

## 4. Multi-Tenant Invariants

- Runtime copies are always scoped by `adoptId`.
- A runtime copy must never be shared across two adopts.
- Platform and marketplace source folders can be global, but installation into
  OpenClaw must always create or update a per-adopt runtime copy.
- User uploaded/generated source folders belong to one adopt workspace only.
- A user deleting a workspace skill folder must not affect other adopts.

## 5. Reconcile States

`reconcileSkills(adoptId, { skillId? })` compares source, runtime copy, and
registry metadata.

| Source | Runtime copy | Content state | Result |
|---|---|---|---|
| exists | exists | matches | `ready` |
| exists | missing | n/a | copy source to runtime, then `ready` |
| exists | exists | runtime stale | refresh runtime copy, then `ready` |
| missing | exists | n/a | delete runtime copy, mark `source_missing` |
| missing | missing | n/a | remove stale registry entry |

MVP stale detection uses source/runtime mtime plus file size. Hashing can be
added later for high-confidence audits, but should not be required for the
first registry rollout.

### 5.1 Legacy Zip Archive Sources

Some pre-registry uploaded skills keep their durable source as a `.zip` package
while OpenClaw executes an extracted runtime directory. In that legacy shape,
source file size and runtime folder size cannot be compared. Reconcile must use
installer support for zip sources:

- if the runtime copy is missing, extract the zip into the per-adopt runtime
  directory and mark the skill `ready`;
- if the runtime copy exists, do not compare zip size to extracted directory
  size; use source mtime to decide whether a refresh is needed;
- if extraction fails or the zip does not contain `SKILL.md`, mark
  `sync_failed` with a human-readable reason.

### 5.2 Marketplace Version Decisions

Marketplace skills add one more reconcile signal: source version. Version
comparison is evaluated before mtime/size refresh so marketplace upgrades are
not missed when a package is republished at the same path.

| Marketplace source version | Installed registry version | Result |
|---|---|---|
| same or missing | same or missing | Use the normal mtime/size reconcile path |
| source newer | installed older | Force refresh the runtime copy, then mark `ready` |
| source older | installed newer | Log an anomaly and keep the installed copy |

Downgrade detection is intentionally conservative. A marketplace catalog
rollback should not silently downgrade already-installed customer skills; it
must be logged as an anomaly for admin review.

MVP uses static scan status only. "Reviewed" means static scan passed; "has
warnings" means static scan passed with warnings; "failed" means static scan
blocked the package. AI review is explicitly deferred.

## 6. Operations

Product wording differs by source, but the registry operations are shared.

| Product action | Allowed sources | Registry operation |
|---|---|---|
| Enable | all sources | `setEnabled(..., true)` and ensure runtime copy |
| Disable | all sources | `setEnabled(..., false)` |
| Uninstall | marketplace | `uninstall` runtime copy; marketplace source stays |
| Delete | uploaded/generated | `destroy` source and runtime copy |
| Rename | uploaded/generated | update source metadata |
| Re-sync | all installed sources | `reconcile` one skill |

Built-in skills do not show delete/uninstall in UI. Marketplace skills show
“卸载”. Uploaded/generated skills show “删除”.

## 7. Sync Failure UX

When runtime sync fails, Lingxia must not pretend the skill is usable.

Required state:

- `sync_failed`
- human-readable `reason`
- a visible “重新同步” action that calls `reconcileSkills(adoptId, { skillId })`

Do not rollback a user workspace source folder on sync failure. The user should
still be able to inspect or repair it.

## 8. Reconcile Timing

Use a small number of predictable triggers:

- Lazy on SkillsPage open.
- Immediately after upload, chat-generated skill creation, install, uninstall,
  destroy, rename, or enable/disable.
- Background safety pass every 30 minutes.

Do not use filesystem watchers in MVP. Per-adopt watchers are expensive and
fragile in banking/multi-tenant deployments.

## 9. Existing Skill Migration

Existing skills must enter the registry through an observable migration, not a
silent first-run explosion and not a permanent dual-track mode.

Phase 1 must provide:

```txt
scripts/migrate-existing-skills.ts --dry-run
scripts/migrate-existing-skills.ts --apply
```

The dry run should report:

- existing runtime skills discovered per adopt
- existing upload package rows in `data/skill-packages/index.json`
- existing marketplace/shared package rows
- registry entries that would be created
- corrupted or ambiguous skills that require manual action
- runtime-only skills that were skipped or would be promoted by the built-in
  allowlist

The apply pass should create registry entries only for unambiguous skills.
Corrupted skills should remain untouched and be reported with reasons.
Runtime-only built-ins require an explicit migration flag such as
`--classify-runtime-only=builtin-allowlist`; default behavior is to skip them.

This mirrors the cron cleanup pattern: dry-run first, apply second, then scan
again until orphan counts are zero.

## 10. Phase Boundaries

Phase 0:

- This document.
- `shared/types/skill.ts`.
- `SkillRegistry` interface plus stub provider.

Phase 1:

- Real reconcile implementation.
- Read-only scan and migration scripts.

Phase 2:

- SkillsPage consumes registry view model.
- Details panel no longer guesses source/delete rules.

Phase 3:

- Upload and chat-generated skills register, reconcile, and become hot-usable.

Phase 4:

- Marketplace install/uninstall uses registry operations.

Phase 5:

- Visual banking-fy pass: remove emoji, simplify details, freeze page audit.

## 11. Known Path Variants

OpenClaw deployments are not path-stable across historical versions and private
customer machines. Implementations must normalize these variants instead of
assuming a single physical layout:

- OpenClaw home may be configured as `/root` or `/root/.openclaw`; normalize to
  the directory whose basename is `.openclaw`.
- Runtime skills may live under either
  `/root/.openclaw/workspace-<runtimeAgentId>/skills/<skillId>` or
  `/root/.openclaw/workspace-lingganclaw/<runtimeAgentId>/skills/<skillId>`.
  Reconcile/onboarding code must probe both and use the path that exists.

These variants were observed in production during Phase 3 onboarding and should
be treated as compatibility requirements, not temporary quirks.

## 11. Runtime Path Resolution

OpenClaw is the runtime source for where an agent actually loads skills.
Lingxia must resolve an adopt's runtime skill directory from `openclaw.json`:

```text
runtime skills dir = agents.list[agentId].workspace + "/skills"
```

Do not hardcode `/root/.openclaw/workspace-lingganclaw/<agentId>/skills` or
`/root/.openclaw/workspace-<agentId>/skills` in new SkillRegistry code. Those
paths are historical deployment variants. The registry may preserve old paths in
existing rows, but reconcile/install must realign runtime copies to the
configured OpenClaw agent workspace before syncing `agents.list[].skills`.

For MVP, OpenClaw does not expose a verified hot config reload API for
`agents.list[].skills`. After allowlist changes, Lingxia writes `openclaw.json`
atomically and invalidates Lingxia session caches; an OpenClaw Gateway restart
may still be required before the runtime sees the new allowlist.
