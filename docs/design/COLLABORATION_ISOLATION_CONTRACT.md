# Collaboration Isolation Contract

Status: Phase 2 in progress  
Owner: Lingxia collaboration / banking onboarding

## 1. Why

Lingxia collaboration cannot remain a code whitelist. Banking customers require hard organization isolation, real names, auditable membership, and admin-configurable access. Linggan platform login remains the authentication source, but Lingxia owns collaboration identity and visibility.

Core problems this contract solves:

- Users from different customer organizations must not discover, mention, invite, or view each other.
- Registration names and companies from the Linggan platform are not trusted display/authorization truth.
- Collaboration access must be configured by admin, not code whitelist.
- Legacy collaboration data must be preserved for audit while new access rules are enforced.

## 2. Terms

- **Auth user**: Existing `users` row from Linggan platform. Source of login identity only.
- **Coop profile**: Lingxia collaboration identity for an auth user.
- **Collaboration Space**: v1 hard isolation boundary. Users can only collaborate with users in the same active space unless they are platform admins.
- **Platform admin**: v1 uses `users.role === "admin"`. v1.5 may add space-level roles.
- **Legacy session**: A collaboration session without a `spaceId` snapshot.

## 3. Data Model

### 3.1 `lx_collab_spaces`

Fields:

- `id`
- `name`
- `description`
- `status`: `active | disabled`
- `sortOrder`
- `createdAt`
- `updatedAt`
- `updatedBy`

A disabled space is read-only for regular users. Platform admins can inspect it.

### 3.2 `lx_collab_user_profiles`

Fields:

- `userId`: auth user id, primary key
- `realName`: Lingxia managed real display name
- `organizationName`: company / organization display and search metadata, not ACL in v1
- `departmentName`: department display and search metadata, not ACL in v1
- `teamName`: team / working group display and search metadata, not ACL in v1
- `spaceId`: nullable collaboration space id
- `status`: `pending | active | disabled`
- `notes`
- `createdAt`
- `updatedAt`
- `updatedBy`

`status` is the single source of collaboration enablement:

- `pending`: cannot collaborate
- `active`: can collaborate if assigned to an active non-null space
- `disabled`: cannot collaborate

Do not add a separate `coopEnabled` boolean in v1. It creates contradictory states such as `pending + enabled`.

### 3.3 `lx_coop_sessions.space_id`

New sessions snapshot the creator's current `spaceId` at creation time. Existing sessions are backfilled with `NULL` and are treated as legacy sessions.

## 4. Source Of Truth

- Auth/login: existing `users` table.
- Collaboration display name/org/department/status/space: `lx_collab_user_profiles`.
- Space definitions: `lx_collab_spaces`.
- Registration company/name fields are only seed hints and must not be used as authorization truth.
- Existing `users.groupId` is deprecated for collaboration isolation. It may be shown for legacy display but is not an ACL source.

## 5. Authorization Invariants

### 5.0 Null Space Means Deny

Any nullable `spaceId` on either side of a regular-user authorization check is deny. This applies even to admin-managed data until the user/session is explicitly assigned.

### 5.1 Profile Activation

A user can participate in collaboration only when:

- Coop profile exists.
- `profile.status === "active"`.
- `profile.spaceId` is non-null.
- The referenced space exists and `space.status === "active"`.

### 5.2 Session Creation

`createCoopSession` must validate every member server-side.

For a non-admin creator:

- Creator profile must be `active`.
- Creator space must be non-null and active.
- Every target user profile must be `active`.
- Every target user must be in the creator's `spaceId`.
- Every target `adoptId` must belong to the target user.
- Auto agent / system user members may bypass the user-space match check because they do not have human coop profiles by design.

If any non-system member fails validation, reject the whole session with `403` or a structured validation error. Do not silently drop members.

### 5.3 Session Visibility

A regular user can view a coop session only if:

- The session exists.
- The session has a non-null `spaceId`.
- The viewer has an active coop profile in that same active space.
- The viewer is the creator or an accepted/active participant according to the session member model.

Platform admins may inspect all sessions.

### 5.4 Mention Candidates

Mention candidates must:

- Only include active coop profiles.
- Only include users in the viewer's same active space.
- Exclude users with null space, pending profile, disabled profile, or disabled space.
- Treat `users.groupId` as display-only legacy metadata.

### 5.5 File Access

`/api/coop/upload` and `/api/coop/file` must enforce the same authorization as session visibility. Guessing `sessionId`, `requestId`, or filename must not grant access.

### 5.6 Disabled Space

When `space.status = "disabled"`:

- Active sessions in that space become read-only for regular users.
- Members may read history if otherwise authorized.
- New messages, new members, file uploads, and new collaboration sessions are denied.
- Platform admins can inspect for operations/audit.

### 5.7 Live Event Boundary

WebSocket/SSE coop event delivery must enforce the same profile and space rules as HTTP session visibility. If a user is disabled or moved out of a space, they must stop receiving live events for sessions they can no longer view.

Implementation requirements for v1:

- Every coop live stream endpoint must resolve the authenticated `userId` and call `canViewCoopSession(userId, sessionId)` before accepting the connection.
- Long-lived streams must re-check `canViewCoopSession` before writing each user-visible event, or at an equivalent short interval. A permission change after the stream is opened must therefore take effect without requiring a page refresh.
- If access is revoked while a stream is open, the server must send one terminal event such as `{ done: true, forbidden: true, reason }` and close that stream. It must not continue sending chunks, completion payloads, file URLs, or result summaries.
- Requester notify streams and target execution streams both follow this rule. In the current Express implementation this covers `/api/claw/collab-stream/:requestId` and `/api/claw/collab-notify/:requestId`.
- Platform admins may still inspect via admin HTTP APIs, but regular live streams must not use platform-admin bypass unless the stream itself was opened by a platform admin session.

### 5.8 User Space Transitions

When an admin moves a user from Space A to Space B:

- Old Space A sessions become read-only/inaccessible according to `canViewCoopSession`.
- The moved user cannot post new events/files/results to old Space A sessions.
- Historical mentions keep their original display text for audit, but they are not clickable as a new collaboration target if now cross-space.

## 6. Legacy Sessions

Existing sessions without `spaceId` are not deleted.

Default behavior:

- `spaceId = NULL`.
- Original creator/member visibility may be retained during transition only where old code path explicitly allows it.
- New helper-based paths return `legacy_archived` for regular users.
- Platform admins can inspect.
- Default legacy retention: 90 days visible to original members where legacy UI still exists, then auto-archived for regular users while remaining admin-visible.

## 7. Helper-Only Policy

All collaboration authorization must go through central helpers. Code review should reject direct ad-hoc joins against coop profile tables for authorization decisions.

Use the same `Result<T, E>` style as ChannelProvider / CronProvider / SkillRegistry.

```ts
type CoopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: CoopErrorKind; detail: string } };
```

Core helpers:

```ts
async function getCoopProfile(userId: number): Promise<CoopResult<CoopProfile>>;

// Returns ok only when profile.status === "active" and spaceId is set.
// Returns CoopResult.error otherwise; caller decides whether to throw or fallback.
async function requireActiveCoopProfile(userId: number): Promise<CoopResult<CoopProfile>>;

async function canCollaborate(requesterUserId: number, targetUserId: number): Promise<CoopResult<{
  requester: CoopProfile;
  target: CoopProfile;
}>>;

async function canViewCoopSession(viewerUserId: number, sessionId: string): Promise<CoopResult<{
  canView: true;
  role: "creator" | "member" | "admin"; // admin = platform-admin override, not session admin
  sessionSpaceId?: number | null;
}>>;
```

Suggested error kinds:

- `profile_missing`
- `profile_pending`
- `profile_disabled`
- `space_missing`
- `space_disabled`
- `space_mismatch`
- `not_session_member`
- `legacy_archived`
- `session_not_found`

## 8. Admin Capabilities

v1 admin UI must support:

- Create/update/disable spaces.
- Edit user real name, organization, department.
- Assign user to a space.
- Set user status: `pending | active | disabled`.
- Bulk assign small batches manually.
- Show warnings before moving active users between spaces.

v1.5 candidates:

- CSV import.
- Pending user notifications.
- Space admin role.
- Department-level filters.

## 9. Routes That Must Use Helpers

- Mention candidates API.
- Session creation API.
- Session detail/read API.
- Session list API.
- Invite approve/reject paths where membership is assumed.
- File upload/download APIs.
- Live event delivery.
- Notification dispatch.

## 10. Migration Plan

### Phase 0: Contract

This document.

### Phase 1: Schema + Read Helpers

- Add `lx_collab_spaces`.
- Add `lx_collab_user_profiles`.
- Add read helpers and tests.
- Add migration script with dry-run/apply.
- No behavior change yet.

### Phase 2: Admin UI + Profile Management

- Add `space_id INT NULL` to `lx_coop_sessions`.
- Backfill existing sessions with `space_id = NULL` so they remain legacy sessions.
- Snapshot the creator's current `spaceId` when creating new collaboration sessions.
- Update `getSession()` helper to read `spaceId` from `lx_coop_sessions`.
- Seed initial spaces.
- Seed minimal known active users for e2e validation only.
- Add Admin page section for spaces and coop user profiles.

### Phase 3: Hook Collaboration Paths

- Mention candidates use same-space filtering.
- Session creation validates all members and snapshots `spaceId`.
- Session detail/list/file access use `canViewCoopSession`.
- Live events enforce the same boundary.

### Phase 4: Productize Onboarding

- New Lingxia users default to `pending` coop profile.
- Admin approves and assigns to space.
- Documentation / SOP for customer onboarding.

## 11. Non-Goals For v1

- Department ACLs.
- Cross-space joint collaboration.
- External guest collaboration.
- Per-file / per-skill / per-cron permissions.
- Customer self-service org admin.
- IdP / LDAP / SSO group sync.

## 12. Multi-Instance Note

Current helpers are DB-backed and safe across instances. Any future in-memory coop cache must be treated as per-instance only unless backed by Redis/shared state.
