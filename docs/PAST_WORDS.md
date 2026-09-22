# Past Words — physical acceptance pending

This explicitly authorized QA feature does not open Phase 11. No commit, push or
hosted deployment is included. The user selected **final, unreplaced assignments
only**; replaced alternatives do not create additional capture opportunities.

## Product and eligibility

Vocabulary → Past Words opens a native stack screen. Missing photos come first,
then captured words; each group is chronological with clear dates, the assigned
term, translation, CEFR and one action. Search matches the immutable assigned term
or translation, with an optional CEFR filter. Add photo opens the existing
camera-first flow with Photo library secondary. Continue photo and Manage photo
recover pending uploads/deletions; View photos opens the existing concept history.
There is no new social badge or reduced-rewards warning.

A new historical reservation requires an authenticated, onboarded owner, an actual
owned final assignment, and a challenge date strictly before the server's current
local date in the persisted IANA learning timezone. Device time, EXIF time, route
intent and catalog IDs cannot grant eligibility. A live daily or historical
reservation/completion/deletion holds the assignment until resolved. A previous
capture of the same concept on another assignment is not this assignment's XP
entitlement. Past Words spans prior learning-language configurations and retains
assignment snapshots.

`get_assignment_photo` returns server-owned daily/historical admission flags.
`reserve_submission` admits new daily reservations only on the current local date;
`reserve_historical_submission` admits earlier assignments. Existing admitted
pending reservations retain their immutable mode across midnight/timezone changes
and recovery. An expired reservation still follows existing deletion/cleanup
rules. No migration reinterprets an earlier daily upload or its earned history.

## Rewards, deletion and integrity

Historical completion creates a private historical fact and **+10 XP only**. It
creates no daily completion fact, streak qualification, milestone, full-challenge
bonus, today/old-day 3/3 progress or daily completion metric. Existing daily-only
`total_words_completed` and fully-completed-day metrics retain their meaning;
visual dictionary capture history includes both kinds. The success receipt says
+10 XP and Added to Vocabulary. Normal current-day camera/library rewards remain
10/20/40 XP and at least one daily completion qualifies its server-local day.

Both modes share the durable `WORD_COMPLETED`, `word:<assignment UUID>` entitlement.
The existing ledger records signed deltas and the current source balance stays
0 or 10. Completed → deleting hides public/history access while retaining credit;
finished deletion after Storage removal revokes the fact and reverses 10 XP.
Resubmission can restore the same 10, never cumulative net rewards beyond that
entitlement. Historical deletion cannot repair or remove unrelated daily streaks.
Deleting a previously daily capture keeps its existing daily reversals; a later
historical replacement restores only word XP, never the former daily credit.

The existing profile/assignment locks, one-live-submission uniqueness, immutable
reservation identity, object/version attestation, commit-time Storage guards and
progress revision serialize two devices, retries and concurrent finalization/
deletion. Visibility does not create new completion events. A lost finalize
acknowledgement is recovered from the server instead of uploading another object.
Capture-kind constraints and private historical-source guards reject inconsistent
ownership, mode and lifecycle data. Ordinary users cannot write facts or XP.

## Schema and deployment

New migration: `20260923000000_past_words.sql`.

- `submissions.capture_kind`: constrained daily/historical, existing rows daily,
  immutable after reservation.
- `private.historical_captures`: source facts separate from daily completions,
  owned assignment/challenge/submission identity, live uniqueness, revocation.
- `private.past_word_entries`: derived owner/date/captured read index, updated by
  assignment/submission lifecycle triggers; it never grants XP.
- New owner-only RPCs `reserve_historical_submission`, `get_my_past_words`.
- Updated `reserve_submission`, `get_assignment_photo` and private progress
  reconciliation/lifecycle functions. Raw RLS/Storage access remains unchanged.

Exact Langtify Dev order, **only after separate deployment authorization**:

1. Back up/review Dev and compare migration history. All earlier approved QA
   migrations through `20260922020000_explore_search.sql` must already be applied;
   if absent, apply those reviewed migrations in filename order first.
2. Apply `20260923000000_past_words.sql` to Dev. Verify existing daily ledger and
   photo counts remain intact; test owner reads and new reservation mode fences.
3. No new Edge Function, function deployment, secret, Storage bucket or cleanup
   schedule is required. Keep the already deployed `photo-authority` and existing
   cleanup worker. Confirm their approved prior versions are healthy.
4. Ship this matching client. The server migration must precede this client,
   because the client requires capture-kind and admission fields.
5. Perform the physical iPhone checklist below before closing this QA feature.

No packages were added/upgraded. Existing Expo Camera/ImagePicker/Manipulator are
reused. `app.json` broadens the Photos purpose text to vocabulary photos and avatar.
An existing binary containing the approved picker can exercise the JavaScript
flow; rebuild to ship the new native purpose text. Personal Team opt-out remains:

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo prebuild --platform ios
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo run:ios --device
```

Do not discard native changes with `--clean`. Builds without the flag keep push.

## Photos, social, caching and performance

Camera and library use the same orientation-normalized, ≤1600px, JPEG-only,
metadata-stripped preprocessing and reserve/upload/attest/finalize path. No new
photo-authority handler or Storage policy is introduced. Private bucket paths,
no-overwrite upload, trusted byte/type/size validation and fixed 60-second signed
access remain unchanged. Cleanup uses the same submission lifecycle and Storage
API; historical pending/deleting objects need no separate worker.

Completed captures join normal concept history. Public captures use existing
Discover/profile/signing/rating/comment/share/block/moderation eligibility; private
captures stay owner-only. Public moderation hides content without changing private
learning credit, as before. No signed URL is placed in route/share parameters.

Owner-scoped server keysets sort by captured state, date and assignment UUID.
Each partition seeks the indexed derived read projection; page size is bounded
1–40, default 20. At most two bounded candidate pages reach the final sort. Search
and CEFR filtering may scan more of that owner's indexed history; they do not load
all historical challenges into app memory. The list has no per-row photo/profile
or signing calls. The client retains 40 rows per window, eight query entries and
explicit More/Back to newest controls. Cross-device status changes can move rows
between partitions; refresh reconciles such movement and IDs are deduplicated.

Cache keys include Auth session, timezone, search and level. Loaded navigation
reuses data without age/focus polling. Submission mutations invalidate affected
Past Words/Vocabulary/progress state; historical-only writes do not invalidate
Today's challenge unless the server context shows that assignment now falls on the
current date after timezone travel. Such a photo is labeled Captured, never daily
Completed. Explicit pull-to-refresh and the existing justified background
policy discover remote/date changes. Account changes retire all scoped data and
in-flight callbacks. Signed capabilities retain original expiry; separate bounded
session pixel caching does not extend URLs.

## Verification and physical acceptance

Final local verification passed:

- Typecheck, zero-warning ESLint, formatting and **743 app tests / 65 suites**.
- The new migration applied successfully to persistent local Supabase; no reset.
- **1,068 DB/RLS assertions / 23 files**, repeated successfully after all integrations.
- **17 integration suites**: new Past Words plus Auth, identity, challenges,
  submissions, photo audit, progress, Vocabulary, Discover, ratings, safety, social,
  inbox, Explore, avatars, notifications and notification sender. This includes
  real Auth/Storage, two-device concurrency, uncertain acknowledgements,
  delete/resubmit reconciliation, byte spoofing, cleanup, timezone travel and
  existing fixed signed-URL expiry checks.
- Separate fresh bootstrap/nonempty replay preserved existing daily and historical
  history. A generic-plan test over **25,000 assignments** confirmed deep indexed
  keyset paging. Persistent and disposable database lint reported no warnings/errors.
- Edge Function typecheck/lint and **23 tests** passed; no function implementation
  changes were required. Four CI setup regression tests also passed.
- Expo Doctor **21/21**, SDK compatibility, public Expo config checks and
  iOS/Android/web exports passed. The source/bundle credential scan checked
  **421 files and both decoded Hermes bundles** with no privileged credentials or
  server implementation in app exports. `git diff --check` passed.

The review caught and fixed a timezone-travel presentation edge case: an admitted
historical capture can later overlap the current challenge date. Today now shows
Captured instead of daily Completed and its cache is invalidated only when the
server context indicates that overlap. Backend daily metrics remain unchanged.
The list also handles deletion of an unfinished upload without pretending it
already earned XP. Tests cover both cases.

Existing historical-day fixtures now model genuinely earlier daily reservation
admission, restoring the exact server-clock definition before commit. No policy,
constraint or test is disabled. Local logs are under
`/private/tmp/langtify-past-*.log`; the temporary Edge Function server was stopped
and the persistent local stack preserved. No hosted data, real push provider,
commit, push or deployment was used.

Physical iPhone checklist:

1. Vocabulary → Past Words: only earlier final assignments, missing first; search
   target/translation, filter levels, paginate, refresh, navigate back from concept
   history and verify cached position/content. Check empty/error/offline states.
2. Add photo with camera and library. Confirm camera remains primary; cancel,
   reselect and retake preserve a coherent preview and private/public controls.
   Check denied/limited Photos access, iCloud-only HEIC and rotated/large images.
3. Capture one and then all three missing words from an old day: +10 each, no full
   bonus, unchanged today's 0–3 progress, streak, historical daily completions and
   daily completion totals. Device-clock changes must not affect admission.
4. Delete a historical capture: public/history disappearance begins immediately,
   net XP reverses after removal finishes. Resubmit restores only 10. Repeat and
   check net entitlement, concept grouping and missing/captured list movement.
5. Confirm public history appears normally in Discover/profile; rating, comments,
   sharing, blocks and moderation work unchanged. Private photos never appear.
6. Interrupt selection, background/resume, kill/reopen during upload, and lose the
   finalize acknowledgement. Recover one object/entitlement, preserving visibility.
7. Sign out/switch accounts during picker/upload/preview; old photos, XP and list
   responses must not appear in the next account. Try two devices on one word.
8. Cross midnight/change persisted timezone during upload. Already reserved daily
   and historical work retains mode; new old-word reservations use historical only.
9. Test safe areas/back swipe, small screens, dark mode, large text, VoiceOver and
   touch targets. Repeat native picker/back/process-loss cases on Android before
   Android acceptance.

Physical acceptance remains pending; local automation cannot certify native
orientation, OEM/iCloud behavior, actual gestures or accessibility rendering.
