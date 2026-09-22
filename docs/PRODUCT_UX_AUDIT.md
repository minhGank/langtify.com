# Final focused Product/UX audit

Audited locally on 2026-09-21, before commit, hosted deployment or physical-device
acceptance. Scope: the new profile/avatar, username discovery, follows, public
profiles, quick ratings, comments/safety, sharing and memory-cache behavior. No new
features, product policies, dependencies or presentation redesign were introduced.

## Findings and fixes

**Critical / high:** none reproduced within the audited boundaries. This is not a
claim that hosted configuration or physical-device behavior has been accepted.

**Medium — previously authorized public data survived a known denial.** A denied
follow closed the profile but left its fresh cache available on reopening. A denied
profile read cleared only that lookup, leaving alternate profile/search/comment
entries available. The fix discards related public data and signed capabilities
only in the originating Auth session, cancels pending reads and does not trigger an
automatic retry loop. Discover/Vocabulary subscribers now respond to clear-only
events as well as refresh invalidations. Regression tests cover another session's
cache remaining intact, alternate profile lookups and visible Discover clearing
without extra page/sign requests.

**Medium — cache invalidation depended on a secondary read.** Confirmed unblock or
moderation writes could be followed by a failed list/case refresh, retaining obsolete
public/comment data. Invalidation now occurs immediately after the confirmed write,
with an aborted/obsolete-session guard, before the secondary read. Tests reproduce
both failed-refresh cases and a late acknowledgement after account switching.

**Medium — uncertain avatar writes retained an obsolete current pointer.** A
finalize/remove operation could commit but lose its acknowledgement, leaving old
avatar metadata fresh for up to five minutes. Failure, background and navigation
now invalidate only the originating session's avatar/profile/search entries and
reconcile through reads. The same upload request remains available for explicit
retry; no write is automatically replayed. Obsolete removal confirmations close.

**Low — verification gaps.** Expanded checks cover banned/deleted social
participants, revoked moderators on comment cases, malformed cursors, Unicode-only
comments, indexed comment pagination under generic plans, nonempty avatar migration
replay, duplicate Storage uploads, malicious JPEG/body inputs and learning-settings
account switches. The local test stack had an already-applied social migration
missing from its migration ledger. Both new migrations were replayed in order,
then that local ledger entry was repaired; normal local migration validation now
reports no pending migrations. This was not a hosted schema change.

An existing Discover integration assertion also compared a new signed URL's expiry
with an earlier URL's issue time, causing a false failure under load. It now requires
`exp - iat === 60` from the same token; the security assertion was strengthened.
Maintenance documentation now states the separate submission/avatar expiry periods
and per-bucket cleanup batch limits.

Audit source edits are limited to `server-cache.ts`, social cache/profile/search/
comment readers, Profile identity/avatar editor, Discover/Vocabulary cache listeners,
and the safety task/blocked-user/moderation screens. No SQL migration, Edge runtime,
package or Expo configuration was changed by this audit. Tests changed in
`tests/{social,safety,server-cache,feed-cache,avatars}.test.ts[x]`, the new
`tests/learning-settings.test.tsx`, `supabase/tests/product-social.test.sql`,
`scripts/test-{db-bootstrap,avatars-integration,discover-integration}.mjs`, and
`supabase/functions/avatar-authority/handler_test.ts`. Documentation changes are this
report, `PRODUCT_UX_PASS.md` and README; earlier uncommitted work remains intact.

## Security and correctness boundaries checked

- Private avatar bucket; owner-only reserved uploads; no raw client read/update/
  delete; service-only, version-bound JPEG verification and fixed 60-second signing.
  Caller paths, identities and TTLs cannot grant access. Replacement/deletion cleanup
  uses Storage API and preserves current objects under concurrent jobs.
- Auth-derived social actors; private raw follow/comment/report/audit records;
  self-follow and duplicate-edge constraints; comment request tombstones and immutable
  text/identity; moderator authorization/revocation; comment cases cannot authorize
  inspection of the parent photo. Existing XP/completion authority is unchanged.
- Public projections expose username, opaque public identity, authorized avatar and
  visible counts, withholding email, Auth UUID and private profile fields. Mutual
  blocks, restrictions, bans and deleted accounts are excluded from relevant reads.
- Ordered Auth/safety locks and submission locks preserve follow/comment, visibility,
  moderation and account-erasure concurrency. Search/comment keysets are bounded;
  actual comment paging uses its index among 25,000 unrelated comments with a forced
  generic plan. Counts remain set-based; search does not sign each result separately.
- Inline/detail ratings share the authoritative vote state; owner posts cannot be
  rated. Cache keys include Auth session and relevant target/filter/cursor; logout
  retires user data. Signed URLs retain their original expiry and stay memory-only.
- Native sharing constructs vocabulary/username text plus `https://langtify.com`.
  It shares no image capability, token, private identifier or executable post route;
  recipients can read the text without installing Langtify.
- CI enumerates the migration directory for bootstrap/replay, runs social/avatar
  integration, and includes `avatar-authority` in function check/lint/test scripts.

## Verification

All checks below passed on the final audit source. Database suites ran sequentially
against local Supabase only, using the documented Docker file-sharing mirror.

| Check                                                        | Result                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                              | Strict TypeScript, zero-warning ESLint, Prettier, **407 app tests / 47 suites**                                                 |
| Local migration validation and `supabase test db`            | No pending migrations; **800 assertions / 19 files**                                                                            |
| Auth/database integration and concurrency                    | All 15 suite commands below passed                                                                                              |
| `supabase db lint --local --level warning --fail-on warning` | No schema errors/warnings                                                                                                       |
| `functions:check`, `functions:lint`, `functions:test`        | All three functions; **23 Deno tests** (photo 6, notification 11, avatar 6)                                                     |
| `npm run doctor`, `npx expo install --check`                 | **21/21**, SDK-aligned                                                                                                          |
| Expo public configuration                                    | Default push-capable and Personal Team configurations validated                                                                 |
| `npm run export:check`                                       | iOS/Android Hermes and web exports                                                                                              |
| `npm run security:scan`                                      | **335 source/config/bundle files + two decoded Hermes bundles**; no privileged credentials/server implementation in app exports |
| `npm audit --audit-level=high`                               | No high/critical finding; 14 known moderate findings remain                                                                     |
| CI setup tests, workflow YAML parse, `git diff --check`      | Four CI setup tests, valid YAML, clean whitespace check                                                                         |

Exact integration commands: `npm run test:auth:integration`, then
`npm run db:test:integration`, `db:test:challenges`, `db:test:submissions`,
`db:test:photo-audit`, `db:test:progress`, `db:test:vocabulary`, `db:test:discover`,
`db:test:ratings`, `db:test:safety`, `db:test:social`, `db:test:avatars`,
`db:test:notifications`, `db:test:notification-sender`, and `db:test:bootstrap`
(each `db:*` name is an npm script). Actual signed URL expiry, real Storage uploads,
competing database transactions and nonempty replay were exercised. The corrected
Discover same-token expiry assertion passed on rerun and did not skip any test.

Existing React Native virtualized-list `act` and Node module-type advisories may
appear in test output; no warnings/assertions were suppressed for this audit.
Local exports and tests do not establish hosted or physical-device acceptance.

**Disposition:** safe to proceed with the ordered Langtify Dev deployment and
physical iPhone QA below. No unresolved critical/high finding was reproduced.
Production release and device acceptance are not signed off by this report.

## Exact hosted deployment order

These are operator steps for **Langtify Dev only**; this audit does not execute them.

1. Confirm the selected project is Langtify Dev, back up its database, inspect its
   migration history through Phase 10 and review a migration dry run. Investigate
   any schema drift; do not copy the local ledger repair to hosted environments.
2. Apply **`20260921000000_product_social.sql`**, then
   **`20260921010000_profile_avatars.sql`**, using the migration runner in that order.
   Both files are transactional. Neither file was changed by this focused audit.
   Preserve all existing migrations and rows; rollback is a reviewed forward repair,
   not dropping populated social/avatar tables or rewriting history.
   The avatar migration extends the public profile/search functions created by the
   social migration. If a manual replay is ever necessary, replay both in order;
   replaying only the older social file would remove the newer avatar projection.
3. Deploy the exact new Edge Function **`avatar-authority`** with its configured JWT
   verification enabled. Preserve `photo-authority` and `notification-scheduler`.
   The new function uses Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`; no new custom hosted secret is required.
4. Update the trusted hourly **`npm run submissions:cleanup`** runner to this code
   revision so it processes both submissions and avatars. Retain server-only
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; alert on failure/retry/backlog and
   missing runs. Never place either privileged key in Expo configuration.
5. Run hosted Dev smoke checks with two ordinary accounts and a separately provisioned
   moderator: private Storage/direct REST denial, avatar replace/remove/cleanup,
   follow/block exclusion, comment report/removal, revoked moderator denial and
   preserved private learning/XP. Ordinary clients must not provision moderators.
6. Rebuild the development client for the already-added `expo-image-picker`, configure
   only the Dev public Supabase URL/key, and perform physical iPhone acceptance. For
   the free Personal Team, keep `LANGTIFY_DISABLE_IOS_PUSH=1` on regeneration/build
   and Metro commands as documented in README. Normal builds retain push support.

## Remaining accepted limitations and acceptance requirements

- Already issued signed URLs may work for their original 60-second lifetime;
  downloaded images cannot be recalled. Remote changes become visible on the next
  authorized read/renewal. A known denial now clears related cached public data.
- Username search intentionally makes eligible usernames discoverable to signed-in
  users. It has a two-character prefix minimum and bounded pages, but no new
  anti-enumeration/rate-limit policy. Bounded requests and validated uploads do not
  prevent deliberate repeated-request/storage-cost abuse. Concurrent renames can move results between
  live pages; refresh reconciles them. Public follow counts can reveal relationships
  in small groups even though raw relationship rows are private.
- Cleanup requires a functioning, monitored trusted schedule. Device/offline and
  network failures can delay reconciliation; writes are never assumed successful
  solely from cached state.
- The 14 previously known moderate npm findings remain; no incompatible forced
  upgrades were performed. No high/critical dependency finding was reported by
  the audit's configured gate.
- Native picker permissions/cancellation, keyboard/sheets, interrupted avatar saves,
  quick/detail rating synchronization, comments, native sharing, background/resume
  and two-account isolation still require the physical iPhone checklist in
  `PRODUCT_UX_PASS.md`. Exports do not establish native acceptance. Domain-only text
  sharing does not create a public web post or app-install deep-link experience.

The audit does not authorize production release, commit, push or deployment.
