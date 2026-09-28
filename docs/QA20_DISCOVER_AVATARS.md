# QA #20 — uploaded Discover author avatars

The user explicitly approved this minimal read-projection extension after the
frontend-only QA #18/#20/#21 pass. No Phase 11, new product rule, dependency, native
configuration, commit, push or deployment. Earlier uncommitted QA work is preserved.
Physical iPhone acceptance remains pending.

## Change and access authority

Migration: `20260926000000_discover_author_avatars.sql`.

Only three existing RPCs change:

- `get_discover_feed`: adds nullable `avatar_id` to each displayed row.
- `get_discover_submission`: adds the same field for canonical public post detail.
- `get_discover_photo_targets`: adds it to the service-only signing projection so
  photo revalidation retains the current author reference.

The reference comes from `private.current_avatar_id`: only a current avatar whose
Storage object ID/version still matches. The internal owner UUID is removed before
JSON serialization. No email, private profile field, avatar path or avatar URL is
added. No table, index, RLS policy or Storage grant changes. The signing-target
return type is replaced within one transaction, restoring its service-only grant.
The old migrations remain intact; this additive migration is replay-safe.

The existing `photo-authority` Edge Function forwards `avatar_id` in its explicit
feed display projection. **`avatar-authority` is unchanged.** It remains the only
avatar signing path: live authenticated viewer, current avatar/object validation,
mutual block and moderation checks, bounded IDs, and a fixed 60-second signature.
The `profile-avatars` bucket stays private. Arbitrary paths and caller TTLs remain
unsupported. Replaced/removed IDs cannot receive new signatures; already issued
capabilities retain their existing short lifetime.

## UI, queries and cache

Discover passes the current bounded window's distinct avatar IDs to the existing
`useConnectionAvatars` hook. It signs only missing avatars in batches of at most 24,
then downloads verified images into the existing bounded session-memory cache.
Cards receive pixels; they never fetch a profile or sign individually. Canonical
public post detail shares the same avatar cache. Initials remain for missing,
unavailable or failed photos, including image-render failure. Public author
navigation and the existing single accessible author target are unchanged.

The existing avatar gateway is now constructed lazily only when a missing image
needs access. Cache-only and empty-avatar renders do not create an API client.
No polling or elapsed-time-only refresh is added. Pull-to-refresh also retries a
failed avatar batch. Account/session scoping, focus cancellation, background hiding
and safety invalidation are inherited from the shared cache. Signed URLs retain
their original admission deadline; downloaded pixels are not renewed capabilities.
Other-device avatar changes appear on the next existing refresh/revalidation, not
through new real-time subscriptions. Private/ineligible owner detail keeps its
existing fallback and does not start public avatar reads.

SQL resolves the avatar after the materialized page limit, using the existing
`profile_avatars_current` partial unique index and verified object lookup. The
feed still has a 24-row maximum and timestamp/UUID keyset ordering. Profile/concept
initial-page RPCs are unchanged; their existing shared photo-signing revalidation
supplies the avatar reference. No per-post network requests or unbounded scan is
introduced. The generic-plan bootstrap regression verifies one indexed avatar
lookup for a one-row feed page among 25,000 unrelated current avatars.

## Verification

Passed:

- Local migration application through `npx supabase migration up --local`.
- `npm run check`: TypeScript, ESLint, Prettier and **849 tests / 74 suites**.
  Nine new tests cover deduplicated batches, rendered avatars/initials, navigation
  cache reuse, pagination, replacement/removal refresh, failures, account changes,
  safety/target invalidation, canonical detail, background cancellation and parsing.
- SQL/RLS tests via `npx supabase test db <mirror>/supabase/tests/`:
  **1,081 assertions / 23 files**. The repository's real tests are copied unchanged
  to the documented Docker-shareable local mirror.
- `npm run db:test:discover`: real Auth/Storage uploaded-avatar projection/signing,
  60-second TTL, replacement/removal, direct Storage denial, block/restriction,
  unchanged keysets and all existing public-photo/privacy/expiry regressions.
- `npm run db:test:avatars`: upload verification, ownership, JPEG/metadata checks,
  replacement fencing, removal, cleanup and account-erasure concurrency.
- `npm run db:test:bootstrap`: nonempty migration replay preserves avatars,
  profiles, photos and XP; restores service-only grants; indexed bounded lookup;
  complete disposable-schema lint passes.
- `npm run functions:check`, `functions:lint`, `functions:test`: all three function
  entrypoints, 15 linted files and **23 tests** pass.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21**.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear`, with dotenv disabled and public local fixtures:
  iOS, Android and web pass.
- `npm run security:scan`: source/config/web and both decoded Hermes bundles pass.
- `git diff --check`: passes.

The first new bootstrap fixture incorrectly reused empty-feed SQL assertions over
nonempty bootstrap data. The replacement fixture then needed cleanup before the
existing final challenge-count assertion. Both test-fixture defects were corrected;
original SQL and bootstrap assertions remain intact. No production logic or test
expectation was relaxed. The existing navigation-fixture and Node module-type
warnings remain unrelated to this change.

All **18** local integration commands passed sequentially (including Discover,
avatars and bootstrap above):

- `db:test:integration`, `db:test:challenges`, `db:test:submissions`,
  `db:test:photo-audit`, `db:test:progress`, `db:test:vocabulary`;
- `db:test:discover`, `db:test:ratings`, `db:test:safety`, `db:test:social`,
  `db:test:avatars`, `db:test:inbox`, `db:test:explore`, `db:test:past-words`;
- `db:test:notifications`, `db:test:notification-sender`, `db:test:bootstrap`,
  `test:auth:integration`.

`npx supabase db lint --local --level warning --fail-on warning` also passed with
no schema warnings/errors. Temporary function serving used normal JWT verification
and was removed after verification, together with the temporary mirror. The
persistent local database/Auth/Storage stack remains running. No hosted project
was contacted or changed.

## Dev deployment order — not performed

1. Review this change together with the existing uncommitted QA work.
2. Apply `20260926000000_discover_author_avatars.sql` to Langtify Dev through the
   approved migration workflow, after its existing social/avatar migrations.
3. Deploy the updated **`photo-authority`** function with normal JWT verification.
   The existing **`avatar-authority`** must already be deployed; it needs no code
   change or redeployment for this task. No new hosted secret is required.
4. Deliver/reload the updated app JavaScript, then perform iPhone acceptance.

Older clients ignore the added field. Updated clients tolerate absent references
and keep initials while the migration/function rollout is incomplete. No new
native dependency or config requires an iPhone development-client rebuild.

## Physical iPhone checklist

1. Browse several authors with and without photos: correct circular uploaded photo
   or initial, stable spacing/scrolling, and one accessible author navigation target.
2. Open a post and return: same author photo, preserved feed position, no flashing
   image reload or unnecessary profile reads. Check light/dark and VoiceOver.
3. Replace/remove an avatar, refresh Discover and reopen detail: new photo/initial;
   a failed or offline avatar request leaves a usable card and initials.
4. Block/restrict an author: affected content disappears on the existing safety
   invalidation/revalidation path; no new signatures are issued for that author.
5. Background during avatar loading, resume, switch target language, and switch
   accounts mid-request: no old-account image or old feed is installed.

Automated verification supports Dev rollout review; the task is not physically
accepted until this checklist passes. No commit, push or deployment was performed.
