# Working on Langtify

## Scope

Phase 10 adds Push Notifications & Beta Hardening on audited Phase 9, explicitly authorized by the user.
The subsequent physical-device QA brief explicitly authorizes profile/avatar editing,
username search and public profiles, follow/unfollow, flat comments with existing
safety controls, native sharing, quick feed ratings and server-state caching. Implement
only this product/UX pass; it is not authorization for unrelated Phase 11 work.
The 2026-09-22 QA2 request additionally authorizes followers/following lists and a
separate in-app notification center for new followers, new ratings and daily words
ready. It does not authorize new remote-push types or Phase 11.
The subsequent physical-device QA brief explicitly authorizes compact semantic
rating, Search/Explore over existing vocabulary concepts and eligible public photo
examples, native post navigation, display capitalization, and profile/comment UX
corrections. Additive search/read RPCs and indexes are within that scope. Preserve
all existing write, privacy, signing, learning and remote-push authority. This is
the QA3 presentation/search pass, not Phase 11; no commit, push or deployment.
The subsequent explicit QA request authorizes native photo-library selection for
current-day challenge words, through the existing camera submission pipeline.
The later explicit Past Words brief authorizes historical camera/library captures
of final, unreplaced past assignments. Keep historical captures separate from daily
completion: the same reversible assignment entitlement grants only 10 XP, with no
streak/day/full-challenge credit. Preserve previously admitted daily-upload recovery.
The subsequent visual-identity request authorizes semantic color tokens and their
presentation across existing screens only: indigo brand, orange energy, yellow
rewards, green completion and red errors. Preserve behavior/backend authority;
physical iPhone review is required. See `docs/COLOR_SYSTEM.md`.
Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and
`docs/DECISIONS.md` before changes. Do not begin Phase 11 or add future product rules.

## Engineering

- Use npm and keep `package-lock.json` in sync. Use `npm ci` on existing checkouts.
- Use `npx expo install` for SDK-compatible dependencies; justify additions.
- Consult the installed SDK's versioned documentation before changing Expo APIs:
  <https://docs.expo.dev/versions/v57.0.0/>. Update this link on an SDK upgrade.
- Keep TypeScript strict. Avoid `any`, unchecked casts, and lint/type suppressions.
- Keep `app/` for routes and layouts; shared code belongs in `src/`.
- Keep components small and typed. Prefer existing primitives and system APIs.
- Support iOS and Android and preserve web compatibility. Minimize platform forks.
- Do not add Redux/global state without a demonstrated requirement or a custom backend.
- Gallery selection is permitted for profile avatars, current-day challenge words
  and server-eligible Past Words. Preserve explicit server-owned capture kind;
  preserve the shared JPEG/metadata validation, lifecycle, XP and recovery authority.
- Do not add likes, friends, DMs, remote social notifications, comment notifications,
  leaderboards, achievements, subscriptions, Apple/Facebook login or AI image validation.
- Keep the photo bucket private. Submission completion, identity and deletion
  must be backend-authoritative. Preserve trusted byte verification, version-bound
  attestations, commit-time object guards and function-only fixed-lifetime signing. Never put cleanup credentials in public env.
- Derive challenge identity/date/configuration and replacements entirely in backend RPCs.
- Preserve concept-level assignment history and immutable challenge snapshots.
- Supabase/PostgreSQL is authoritative. Use RLS, constraints and atomic writes for
  onboarding; never trust a client completion flag or expose service-role keys.
- Keep migrations, database types, seed and database tests consistent.
- XP is server-owned: +10 per valid word, +10 per full challenge; signed reversals
  on finished deletion. Never compute lifetime XP from positive ledger entries only.
- One valid word qualifies a server-derived local date. Milestones 3/7/14/30/60/100
  award 10/25/40/75/125/200 once per occurrence; preserve original windows and no
  retrospective awards caused by deletion. Level threshold is 25 × L × (L + 3).
- Keep durable XP source keys independent of session DateStyle/TimeZone. Check
  level thresholds with exact arithmetic after estimating a level. Never rewrite
  ambiguous existing ledger history to make a migration pass.
- Preserve private progress sources, owner-only immutable ledger, atomic lifecycle
  reconciliation, revision-based serialization and account-scoped progress reads.
- Past Words uses server time/persisted timezone and actual owned final assignments,
  never arbitrary catalog IDs. Historical facts stay outside daily word completions,
  streak runs and bonuses. Daily/historical captures share one reversible word XP
  entitlement; retries, deletion/reupload and two devices cannot multiply it.
- Do not invent product rules. Record unresolved questions and obtain requirements
  when future work depends on them.
- Google OAuth uses Supabase `signInWithOAuth`, S256 PKCE and the centralized
  `langtify://auth/callback` redirect. Preserve the audited session state machine,
  staged exchange, guarded storage writes/admission and account-scoped requests.
  Recovery must match Auth session IDs, and browser auth mutations/broadcasts must
  retain cross-tab coordination. Keep callback sanitation before Router initialization. Never consume
  implicit URL tokens, log callback URLs/codes, or enable manual identity linking.
- Google testing requires a native development build and hosted Langtify Dev.
  Preserve the existing public env names and local provider configuration.
  Apple Sign-In remains deferred until Apple Developer membership is available.
- Vocabulary history reads existing completed submissions and immutable assignment snapshots.
  Group by concept UUID, use latest surviving capture text/CEFR, keep all earlier captures.
  Exclude pending/deleting/deleted rows; do not change XP or completion authority.
  Preserve owner-only security-invoker queries, bounded keyset pages, batch 60-second
  photo signing, and account/session invalidation. Recent metadata may survive navigation;
  signed capabilities must keep their original expiry. Never start reads from
  an inactive screen or an obsolete gateway callback. Abort superseded requests;
  use monotonic elapsed time for preview expiry and retry fresh image instances.
  No category inference.
- Discover is an authenticated, onboarded, saved-target public read projection.
  Preserve completed/public/valid-owner/verified-object eligibility and historical
  vocabulary snapshots; never broaden raw submission/profile/Storage RLS.
  Batch sign only eligible IDs for 60 seconds, with service-only target lookup and
  verified viewer identity. Never accept caller paths, identity overrides or TTLs.
  Keep timestamp/UUID keysets indexable under generic plans, bounded memory/queries
  and stale-account guards. Ignore callbacks from obsolete focus lifetimes. Treat
  failed signatures for eligible rows as retryable errors, never silent pagination
  omissions; only the eligibility lookup may omit an unauthorized/unavailable row.
  Preserve the paging cursor when revalidation empties a previously loaded window.
  Phase 9 adds mutual blocking, private reports and backend-authorized moderation.
  Preserve private learning and XP when public content or accounts are restricted.
  Ordinary clients cannot provision moderators or access reporter/block relationships.
  Every moderation write has an immutable, retry-safe audit record.
- Ratings measure vocabulary meaning only: 1 Not related, 2 Poor match,
  3 Understandable, 4 Clear match, 5 Perfect match. Auth-derived nonowner voters
  must satisfy current Discover eligibility. Enforce one integer score per
  submission/rater, serialize against visibility/deletion and compute authoritative
  grouped summaries for bounded pages. Never expose raw rater history or client
  aggregate writes. Retain votes when private/soft-deleted; cascade on hard deletion.
  Keep mutation/read ordering and stale-session guards; uncertain responses require
  authoritative reconciliation, never automatic replay of older score intent.
  Bound rating request waits so stalled transports cannot hold controls indefinitely;
  cancellation must settle locally and release queued reads without replaying votes.
  Ratings have no XP, streak, completion, ranking or remote-push effect. The QA2
  inbox may record the first rating of a submission by a user without revealing
  the rater's identity or individual score.
- Safety operations use Auth-derived actors, bounded private queues/lists and controlled
  reasons. Moderator provisioning is trusted SQL only. Keep request-ID audit
  idempotency, mutual block checks, public restriction/removal admission locks, and
  report-scoped 60-second moderator previews. Never conflate removal with completion
  deletion or XP reversal. Clear privileged state on lost access and account/focus changes.
- Never commit secrets. `EXPO_PUBLIC_*` is public client configuration.
- Generated `ios/`, `android/`, `.expo/`, and `dist/` remain untracked.
- Preserve unrelated user changes. Update documentation when decisions change.

## Verification

Run `npm run check` before handing off a change. For navigation, dependency, or Expo
configuration changes also run `npm run export:check`, `npx expo install --check`,
and `npm run doctor`. For database changes also run `npm run db:test` and
`npm run db:test:integration`, `npm run db:test:challenges`, `npm run db:test:submissions`, `npm run db:test:bootstrap`, `npm run db:test:photo-audit`, `npm run db:test:progress`, `npm run db:test:vocabulary`, `npm run db:test:discover`, `npm run db:test:ratings`, `npm run db:test:safety`, `npm run db:test:notifications`, `npm run db:test:notification-sender` and `npx supabase db lint --local --level warning` against local development only;
see README for the Docker file-sharing fallback. Tests belong outside `app/`; exercise observable behavior
instead of snapshots or implementation details. Add tests when they protect
meaningful behavior, not merely to mirror trivial code.
Run suites that use the same local database sequentially: their temporary Auth/photo
fixtures can affect another suite's catalog, feed and ledger assertions. Bootstrap
uses a separate disposable database; its privileged query-plan fixture always rolls back.

Report commands, outcomes, limitations, and physical-device checks still needed.
For the authorized product/UX pass, also run `npm run db:test:social` and
`npm run db:test:avatars`, `npm run db:test:inbox`, `npm run db:test:explore` and `npm run db:test:past-words` sequentially with other DB suites. Keep comment/follow
authority behind Auth-derived RPCs, private report/audit records and ordered safety
locks. Gallery access includes current-day challenge words; preserve private avatar Storage, trusted JPEG
verification and cleanup. Caches remain session-scoped, bounded and memory-only;
metadata freshness must never extend signed capabilities. See `docs/PRODUCT_UX_PASS.md`.
For auth changes also run `npm run test:auth:integration` against local Supabase.
Bundle export is not a native binary build or a substitute for device testing.
Photo changes must include Storage-policy and recovery/cleanup verification. Keep
the hourly cleanup job documented and tested; use Storage API for physical deletion.

For Edge Function changes also run `npm run functions:check`, `npm run functions:lint`
and `npm run functions:test`. Deno imports are pinned separately from the mobile
package; never pull server-only credentials or the decoder into Expo bundles.

## Phase 10 notification authority

- The user explicitly approved at most one provider send attempt per user/type/local
  date, preferring a missed push over duplicates. Commit the attempt before network
  I/O; never automatically resend uncertain/failed attempts. Receipt polling is read-only
  at the provider and may retry. Record outcomes without claiming device delivery.
  Invalidate definite unregistered tokens only when the attempted binding still matches.
  Historical blocked rows are not a backlog. Phase 11 remains out of scope; see decision 029.
- Preserve Auth-derived preferences, persisted IANA time, service-only bounded
  scheduling, authoritative challenge snapshots and existing streak rules. No local
  device scheduler, client words/dates, remote social notifications or new XP behavior.
- Token registration requires a real live Auth session and installation capability;
  monotonically persisted revisions fence stale account writes. Anonymous capability
  calls may only revoke. Never expose tokens/hashes/job credentials in public reads,
  logs or app config. Keep the Android Firebase client file distinct from FCM secrets.
- Preserve permission opt-in/no-nag behavior, fixed Today-only matching-account taps,
  cached-response cleanup, abort/deadline handling and safe uncertain-write recovery.
- Revoke the previous installation scope before native permission/token lookups on
  cold start or Auth changes. Resolve local schedule times to the same IANA timestamp
  for due checks, claims and final authorization, including DST gaps/folds. Release
  rejected provider response bodies. Preserve the regressions in `docs/PHASE10_AUDIT.md`.
- Before processing preferences, scheduler batches lock all candidate Auth users,
  profiles and learning rows in ordered stages. Preserve this cross-candidate lock
  order against account rebinding and concurrent send admission.
- Run notification application tests, `npm run db:test:notifications` and
  `npm run db:test:notification-sender`, plus the
  existing sequential database/Auth/Storage/safety suites, migration replay, function
  checks, all-platform exports and `npm run security:scan`. Record physical, hosted
  and actual provider-delivery checks separately; do not fabricate successful delivery.

## QA2 correction invariants

The authorized follow-up QA batch fixes existing navigation, avatar presentation,
public-profile posts, cache triggers and password guidance; it does not open Phase 11.
Do not reintroduce stale-time/focus polling for loaded browsing data. Signed URLs
keep their original expiry; bounded session-only downloaded pixels may be reused
without reusing an expired URL. Account/safety invalidation still clears affected
state. Preserve unfinished-upload recovery and moderator revocation checks. See
`docs/QA2_CORRECTIONS.md` for exact refresh and physical acceptance rules.

Follower lists must use controlled public projections and batch avatar access,
not per-row profile/signing requests. The in-app inbox is server-generated and
owner-scoped with current block/moderation/content eligibility, durable event
deduplication and controlled read-state RPCs. Do not add polling, caller-created
events or caller-supplied navigation URLs. Remote push remains DAILY_WORDS and
STREAK_AT_RISK only, including Personal Team builds. Physical iPhone acceptance
is required before closing the remaining QA2 scope.

For the authorized QA3 search/navigation pass, preserve existing concept/term
identity, immutable photo snapshots and saved-target Discover eligibility. Search
must remain indexed, bounded and Auth-derived; never add raw Storage access or
caller-selected signed URL paths/TTLs. Public post detail belongs in the native
stack with normal edge-back navigation; never seed fresh post state from an
invalidated source. Capitalization is presentation only. Unchanged normalized
username Save stays disabled. See `docs/QA3_SEARCH_NAVIGATION.md` for verification,
rollout and required physical acceptance.
