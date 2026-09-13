# Phase 4 — Camera Capture & Photo Submissions

Historical implementation report. See [Phase 4 audit](PHASE4_AUDIT.md) for superseding
security fixes, current results and rollout constraints.

Implemented and verified locally on 2026-09-12. Phase 3's audited migrations remain
unchanged. No streaks, feed, ratings, comments, followers, notifications, gallery
upload or AI image validation were added. Phase 5 has not started.

## Schema and Storage

`20260912040000_phase4_submissions.sql` adds an authoritative `submissions` table,
private cleanup queue, owner RPCs and Storage policies in an explicit transaction.
Assignment/owner/concept/term/text/path identity is copied from real, active, owned
challenge assignments. Composite foreign keys protect those relationships;
immutable columns and transition triggers prevent invented completion or metadata.
A partial unique index permits one non-deleted submission per assignment. Indexes
support owner/history/cascade and cleanup queries. Previous challenge configuration
and historical text remain unchanged.

The dedicated `challenge-submissions` bucket is **private**, accepts JPEG uploads
up to **5 MiB**, and stores objects at server-derived `<user-id>/<submission-id>.jpg`.
The database stores this path, not a public URL. Storage RLS authorizes the exact
unexpired owner reservation; a matching folder alone is insufficient. Overwrite,
upsert and move lack an UPDATE policy. Nonempty custom object metadata is denied.
Owners can read their live objects and delete only after recorded deletion intent.
Anonymous and cross-user access is denied even when visibility is `public`.

Visibility defaults to `private` in SQL and OFF in the preview. Public marks future
feed eligibility and grants no additional access in this phase. Owner detail uses
60-second signed preview URLs held only in memory and refreshed while visible.
Visibility changes never move objects. No feed read policy or sharing action exists.

## Camera and preprocessing

The SDK-compatible packages installed through `npx expo install` are `expo-camera`,
`expo-image-manipulator`, and `expo-file-system`. Camera uses `CameraView` with
explicit permission handling, a denied/settings state, readiness gating, capture
and mount errors, retry, cancellation, retake and preview. It mounts only while
focused and foregrounded. No gallery, microphone or location permission is requested.

Deterministic preprocessing:

1. Capture with processing enabled (`skipProcessing: false`) and `exif: false`.
2. Resize proportionally to a maximum **1600-pixel longest edge**, without upscaling.
3. Decode/re-encode as JPEG at **quality 0.8**.
4. Remove every JPEG APP and comment segment, including EXIF/GPS/XMP/IPTC/ICC and
   thumbnails; discard bytes after the JPEG end marker. Preserve scan data, including
   progressive scans, byte stuffing and restart markers. Reject malformed input.
5. Reject output above 5 MiB. Delete raw/intermediate cache files. Only the sanitized
   bytes back the preview and upload.

The preview must emit an image-load event before Submit is enabled. Capturing never
uploads automatically. Native normalized drafts use account/assignment-scoped cache
files with unique URIs to prevent stale retake images. Success, retake and discard
remove them; loading removes that account's drafts older than 24 hours or damaged
by interrupted writes. Native OS cache eviction can require a retake. Web keeps
unuploaded previews in memory; uploaded reservations are recoverable on all platforms.

API choices were checked against [Expo Camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/),
[Expo ImageManipulator](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/),
and [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## Upload, completion and recovery

Database and object storage are coordinated through durable states, rather than
claimed to be one distributed transaction:

| Step     | Authoritative behavior                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Reserve  | Derive identity/path in SQL; create or reuse one `pending` row. No completion yet.                                         |
| Upload   | Insert JPEG at the exact reserved path with no overwrite; upload bytes as an ArrayBuffer.                                  |
| Finalize | Verify an active assignment and stored object metadata/size/MIME; atomically mark `completed` with server submission time. |
| Retry    | Reuse the reservation. Completed finalization returns the same result without changing visibility or creating duplicates.  |
| Recover  | Reload the row and actual uploaded preview. A recovered photo must be reviewed before finalization.                        |

The four bottom tabs remain in place; each of the three vocabulary cards
now exposes Take Photo/Replace before completion and Completed/View Photo afterward.
A pending upload offers Resume photo and temporarily blocks replacement. An owner-only
Unfinished photos section also recovers earlier-date operations after restart/midnight,
independently of whether the current daily challenge can be generated. Completed
assignments cannot be replaced or submitted twice. These rules are enforced by
SQL and privileges, including direct REST/Storage attempts, not only by the UI.

The protected `/photo` screen shows saved target/reference words, challenge date
and timezone, the photo, submission time and visibility. It allows owner-authorized
visibility changes and confirmed deletion. A started upload can finish against its
original still-active assignment after midnight; it retains that challenge's saved
date/language/terms. No client date or invented same-day cutoff was introduced.
Pending reservations have a server-owned 24-hour recovery lease.

Photo state remounts on account/assignment changes. A separate non-persisting client
pins Storage and RPC requests to that account's JWT. Unmount invalidates responses
and stops subsequent upload/finalization stages. Same-account token refresh uses
the latest gateway for later stages and reconciliation. Reads cannot race ahead
of pending writes, and duplicate submission taps are blocked locally and in SQL.

## Deletion and maintenance

Deletion records `deleting`, removes bytes through Storage API, then transitions to
`deleted` only when object metadata is absent. The assignment cannot accept a new
photo/replacement until retirement completes. Retries are idempotent. Soft-deleted
rows retain immutable vocabulary/operation metadata so an uncertain old delete
cannot affect a new submission. Account/challenge cascades leave durable cleanup work.

`scripts/cleanup-submissions.mjs` is a **server-only** maintenance command. It claims
expired pending/deleting rows, removes objects through Storage API, then retires
rows and clears successful jobs. Failed work remains queued. An orphan scan also
finds late objects or files without a live submission, including after a previous
cleanup completed. It never deletes `storage.objects` directly. Each invocation
handles up to 100 queued paths and logs counts, not credentials, paths or user IDs.

Install [the hourly cron example](../ops/submissions-cleanup.cron.example) on a
trusted runner with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` supplied through
protected server configuration. Monitor unsuccessful runs, retry counts and backlog;
increase frequency for larger queues. **A deployed cleanup schedule is required
before enabling hosted uploads.** The worker is implemented and tested locally;
no persistent external schedule or hosted deployment was installed by this task.
No privileged key was added to Expo or to committed environment files.

## Commands and results

| Command/check                                                          | Result                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx expo install expo-camera expo-image-manipulator expo-file-system` | Installed SDK-compatible packages; npm lockfile updated.                                                                                                                                                                                                     |
| `npx supabase stop` / `npx supabase start`                             | Restarted only local Langtify services with data preserved and Storage enabled.                                                                                                                                                                              |
| `npx supabase migration up --local`                                    | Phase 4 migration applied locally; subsequent run had no pending migrations.                                                                                                                                                                                 |
| `npm run check`                                                        | Typecheck, zero-warning lint, formatting and **141 application tests in 19 suites passed**.                                                                                                                                                                  |
| `npx supabase test db /private/tmp/langtify-phase4-tests/`             | **208 pgTAP tests in six suites passed**, including 46 submission/Storage-policy checks and all prior-phase tests.                                                                                                                                           |
| `npm run db:test:submissions`                                          | Ten real local Auth/Storage integration scenario groups passed, including concurrent reservation/finalization, private access, MIME/size/custom-metadata denial, restart recovery, deletion, expiry, replacement races, account cascades and orphan cleanup. |
| `npm run db:test:integration`                                          | Five identity/seed/migration safety scenarios passed.                                                                                                                                                                                                        |
| `npm run db:test:challenges`                                           | Four existing challenge/catalog concurrency scenarios passed.                                                                                                                                                                                                |
| `npm run db:test:bootstrap`                                            | Three bootstrap/backfill/preflight checks passed, including Phase 4 setup with existing challenges.                                                                                                                                                          |
| `npx supabase db lint --local --level warning`                         | No schema errors.                                                                                                                                                                                                                                            |
| `npx supabase gen types typescript --local --schema public`            | Fresh temporary generated types matched `src/types/database.ts` after formatting.                                                                                                                                                                            |
| `npx expo install --check`                                             | Dependencies compatible/up to date.                                                                                                                                                                                                                          |
| `npm run doctor`                                                       | **21/21 checks passed.**                                                                                                                                                                                                                                     |
| `npx expo config --type public --json`                                 | Public configuration resolved with Langtify camera settings.                                                                                                                                                                                                 |
| `CI=1 npm run export:check -- --clear`                                 | Fresh **iOS, Android and web** exports passed, including the protected photo route.                                                                                                                                                                          |
| Credential/whitespace review                                           | No privileged JWT, Supabase secret key or private-key material found in scanned repository files/exported bundles; local env ignored; `git diff --check` passed.                                                                                             |

Docker Desktop does not share `/Applications/langtify.com`, so exact SQL suite
copies were run from a shared temporary directory with the usual Supabase test
runner. SQL policy tests use rollback-only metadata fixtures; real image operations
are exercised separately through Storage API with isolated, deleted test accounts.
The bootstrap test models minimal Auth/Storage SQL contracts, not service provisioning.
The real integration test uses the actual running local Auth and Storage services.
The type generator's listener-count warning did not prevent successful matching
output. Expo's color-environment warnings did not affect exports. Credential review
covered 209 current files/bundles; native Hermes bytecode was decoded to avoid
false tokens formed by adjacent string-table entries. The SDK's `sb_secret_`
prefix check is present, but no privileged key value was found.

## Exact physical-phone acceptance tests

Use **both iOS and Android** with the migrated development project and compatible
Expo Go (`npm start`) or a newly built development binary. A local Supabase API
must use the computer's reachable LAN address on a physical phone, not `127.0.0.1`.
Confirm the private bucket and install cleanup in any deployed test environment.

1. Sign in with an onboarded account and open Today. Tap Take Photo on one word.
   Deny camera permission; confirm the explanation, retry and cancel controls.
   Disable permission permanently in device settings, return, and verify Open
   settings. Grant permission there and resume; the camera should become usable.
2. Check camera startup/loading and cancellation. Photograph something in portrait
   and landscape, including a high-resolution image. Verify upright orientation,
   reasonable colors/sharpness, and usable scrolling/safe areas. Capture should
   show a preview and leave the word incomplete until explicit submission.
3. Confirm Share with the Langtify community is OFF. Turn it ON, retake, and confirm
   it resets OFF with the newly captured image rather than an old cached preview.
   Submit must remain disabled if the preview cannot load.
4. Submit privately, including rapid double taps. Return to Today: exactly that
   assignment should show Completed/View Photo, without Replace or another Submit.
   Reopen/relaunch and verify the same stored photo and words. Submit another word
   with sharing ON and verify its persisted Public label.
5. Open View Photo. Toggle Private -> Public -> Private, refresh/relaunch after
   each, and confirm persistence. With a second account, verify the first account's
   photo route is unavailable even when its visibility is Public.
6. Disconnect during upload and during finalization. Reconnect and refresh/resume;
   recover the preview, explicitly submit if still pending, and verify only one
   completion. Force-close/relaunch after upload before finalization. If a native
   pre-upload cache is evicted, confirm a retake is offered. Repeat background/resume
   during capture/upload and ensure only one camera preview is mounted.
7. With two devices signed into the same account, submit against the same assignment
   simultaneously. Confirm one saved submission and consistent Completed state.
   If another device uploaded first, review that recovered image before finalizing.
   Attempt replacement from a stale Today screen; it must fail safely.
8. During a delayed capture/upload/read, sign out and switch accounts. Old previews,
   words, operation results and signed URLs must not appear for the new account.
   Confirm `/photo` cannot bypass signed-out or onboarding route guards.
9. Delete a completed photo, first cancelling confirmation, then confirming. After
   deletion finishes, View Photo should disappear and Take Photo/Replace return.
   Capture again. Repeat while offline after recording delete intent; reconnect
   and Finish deletion, or run cleanup. Confirm the old image is removed and retrying
   its deletion cannot remove the new photo.
10. Start a capture before local midnight and finish afterward. Confirm it belongs
    to the original assignment/date and Today refreshes to the new server date.
    Restart with an unfinished prior-date upload; use Unfinished photos to resume
    or discard it without changing its original vocabulary/date.
    Change only the phone clock/timezone: this must not rewrite challenge history.
11. Using authorized development access, inspect an uploaded camera photo: longest
    side <=1600, size <=5 MiB, JPEG, and no EXIF/GPS/XMP/IPTC metadata. Confirm the
    original capture is not saved to the device photo library automatically.
12. Test large text, VoiceOver/TalkBack, light/dark appearance and small screens.
    Verify permission/error/deletion messaging and controls remain accessible.

## Remaining risks and deployment boundary

No known blocking implementation defect remains in the locally tested scope.
Physical-phone/native-code behavior, signed native builds and hosted rollout remain
unperformed. Required deployment steps are applying the migration, configuring the
public mobile URL/key, installing/monitoring cleanup and completing phone acceptance.
A failed or unscheduled cleanup job delays abandonment/deletion cleanup; this is
an operational requirement, not an optional convenience.

The camera-only flow and metadata stripping apply to the shipped client. Storage
checks MIME/size/reservation; it does not attest that a malicious API caller used a
physical camera or decode/re-encode arbitrary bypassed uploads on the server. No AI validation was
added. Privileged administrators remain trusted for Storage/schema operations.
Signed URLs are bearer capabilities until expiry; visibility changes cannot revoke
already-issued links immediately or erase downloaded copies. Native draft cache
is app-private but not an encrypted vault and can be evicted; web pre-upload drafts
are lost on reload. Test camera memory/performance on actual high-resolution devices.

Npm continued to report the existing **14 moderate** Expo-chain advisories during
installation. No forced SDK-breaking dependency changes were made. Vocabulary
content review/licensing, load testing, final release identifiers/signing and later
product policy remain separate work. Credential review covers current files and
bundles, not a forensic audit of Git history or external infrastructure.

## Changed files

Compared with the working tree at Phase 4 start: **44 files**. Generated exports,
ignored runtime state and temporary checks are excluded; all previous migration
files and the local public environment file were preserved.

- `AGENTS.md`
- `README.md`
- `app.json`
- `app/_layout.tsx`
- `app/photo.tsx`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/PHASE4_VERIFICATION.md`
- `docs/PRODUCT.md`
- `docs/ROADMAP.md`
- `ops/submissions-cleanup.cron.example`
- `package-lock.json`
- `package.json`
- `scripts/cleanup-submissions.mjs`
- `scripts/lib/local-api.mjs`
- `scripts/test-db-bootstrap.mjs`
- `scripts/test-submissions-integration.mjs`
- `src/features/challenges/errors.ts`
- `src/features/challenges/today-screen.tsx`
- `src/features/photos/camera-capture.tsx`
- `src/features/photos/jpeg.ts`
- `src/features/photos/photo-files.ts`
- `src/features/photos/photo-preview.tsx`
- `src/features/photos/photo-screen.tsx`
- `src/features/photos/unfinished-photos.tsx`
- `src/features/photos/use-assignment-photo.ts`
- `src/services/challenges.ts`
- `src/services/submissions.ts`
- `src/types/database.ts`
- `supabase/config.toml`
- `supabase/migrations/20260912040000_phase4_submissions.sql`
- `supabase/tests/phase4.test.sql`
- `tests/camera.test.tsx`
- `tests/fixtures/photo.jpg`
- `tests/jpeg.test.ts`
- `tests/navigation.test.tsx`
- `tests/photo-files.test.ts`
- `tests/photo-fixtures.ts`
- `tests/photo-screen.test.tsx`
- `tests/photo-service.test.ts`
- `tests/photo-state.test.tsx`
- `tests/today-screen.test.tsx`
- `tests/unfinished-photos.test.tsx`
