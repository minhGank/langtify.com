# Current-day photo library — physical acceptance pending

This document records the original current-day gallery pass. The later authorized
[Past Words pass](PAST_WORDS.md) supersedes its old-word admission restrictions and
uses one server-owned photo-context read. Existing daily recovery is preserved.
Neither pass opens Phase 11. No commit, push or deployment is performed.

## Interaction

Camera remains the primary capture action. Its shutter has a secondary Photo
library action, also available when camera permission is denied. The photo landing
screen offers Take photo followed by Choose from library. Preview retains Submit,
private-by-default visibility, Retake, Discard and a secondary Choose another photo.
Cancelling selection leaves the previous draft and visibility unchanged. Selecting
a new image resets sharing to private and requires a loaded preview before Submit.

The installed `expo-image-picker` opens the native single-image system picker:
no custom chooser, broad permission preflight, editor, video, location permission
or explanation screen. Limited/denied broad access does not block system-selected
photos. Actual permission errors have safe copy and a Settings action. See the
[Expo SDK 57 picker documentation](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/).

## Current-day admission and shared authority

The existing account-pinned `get_assignment_photo` and argument-free
`get_my_progress` reads match ownership, active assignment, current challenge ID
and server local date. They do not generate a challenge. No route flag, device
date, EXIF date or caller-supplied challenge date establishes eligibility. Selection
is rechecked after the picker and before new library bytes upload. No new library
action is offered for old/completed/deleting words or already-uploaded recovery.

Library draft filenames retain a local source marker through restart. An old draft
cannot begin a new library upload. Existing server-uploaded recovery is deliberately
source-neutral, including after midnight. These admission reads do not atomically
lock calendar time across native selection/network transfer: a transfer admitted
just before midnight may finish later. The existing database finalization time and
persisted IANA timezone decide the streak day. There is no historical gallery UI.
Provenance is not a trusted backend field; bytes cannot prove camera/library origin.

Both sources use `preparePhoto`: native orientation normalization, resize from the
actual oriented dimensions to at most 1600px on the longest edge, JPEG quality 0.8,
5MB bound, and stripping every APP/comment/trailing metadata segment. The same
private bucket, no-overwrite reservation, upload, trusted photo-authority decode/
attestation, finalize, signing and visibility controls apply. Library originals
are never deleted; normalized temporary intermediates are removed. Picker-owned
source copies remain disposable OS cache, as with existing avatar selection.

No schema, migration, Edge Function, RLS, service secret, remote-push, XP or streak
change is introduced. Each word earns 10 XP, 3/3 earns another 10 (40 total), and one
completion qualifies its server-local day. Existing ledger source keys, concurrent
finalization, reversals and signed source balances prevent retry/delete farming.

## Interruptions

- Cancellation creates no reservation or upload and keeps an existing preview.
- Native iOS inactive/background transitions do not discard an open picker. The
  selected result waits for foreground, then revalidates today's assignment.
- Screen/account/session changes abort reads and fence picker/preparation results;
  an obsolete callback cannot install into another scope. In-flight server writes
  retain their original JWT and normal recovery semantics.
- Repeated taps open only one picker. Pending preparation disables draft mutations.
- Upload interruption reuses the reservation. Uncertain upload/finalization reads
  recover the stored object/completion before an explicit retry; no extra XP path.
- Android activity/process loss does not consume an unscoped pending native-picker
  result. Select again if no prepared draft exists; account-scoped prepared drafts
  and server uploads retain existing recovery.
- Web uses the existing in-memory draft behavior. Some browsers do not return a
  cancel event; leaving/reopening the photo screen clears that pending picker state.

## Native configuration and rollout

No dependencies added or upgraded. `app.json` broadens the existing iOS photo-library
purpose text to vocabulary challenges and avatars. Native rebuild is required to
ship that text; an existing binary already containing Expo ImagePicker can exercise
the JavaScript flow. No Android capability change or backend deployment is required.
Personal Team push suppression remains opt-in and unchanged.

After separately authorizing device build/installation, regenerate and run:

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo prebuild --platform ios
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo run:ios --device
```

Do not use `--clean` to discard local native changes. Normal future builds without
the flag retain push support.

## Automated verification

Application regressions cover permission/cancel behavior,
picker source validation, foreground/account lifetimes, oriented preprocessing and
metadata stripping, current-day admission and shared private/public recovery.
The real submission integration additionally mixes source-neutral normalized bytes
and proves 10/20/40 XP, one streak day, exact retry idempotency, private/public
Discover eligibility, Vocabulary captures and deletion/resubmission net 40 XP.

Final local run: TypeScript, zero-warning ESLint, formatting and **670 application
tests in 63 suites pass**. Expo Doctor is **21/21**; SDK compatibility passes.
All three platform exports and the source/bundle credential scan pass. Edge
Function typecheck/lint and **23 tests** pass. **All 16 integration suites and the
separate bootstrap/replay suite pass**, covering Auth, challenges, submissions,
photo security, progress, Vocabulary, Discover, ratings, moderation, social, inbox,
Explore, avatars and notification preparation/sending. The complete **962 DB/RLS
assertions in 22 files pass again after all integrations**, proving persistent
schema preservation. Local database lint passes with
`--level warning --fail-on warning`. Source/bundle scan covers 407 files and both
decoded Hermes bundles; `git diff --check` passes. Tests use local Supabase and an
instrumented notification transport; no hosted or real provider sends occur.

Verification found an existing test-harness defect: the avatar integration committed
an older migration replay, removing QA3 People search fields from the persistent
local database. The initial DB/RLS run therefore failed Explore assertions 38/39.
Execution stopped and the exact failure/cause were reported before repair. The
existing idempotent QA3 migration was replayed locally to restore its approved
definition; all 962 assertions then passed. Avatar replay now performs its unchanged
lifecycle/Storage/security assertions within a rollback-only transaction and verifies
the newer People-search definition is identical afterward. No migration file or
hosted schema was changed for this fix.

Only test-fixture accounts/data were created and cleaned up. The persistent local
stack was preserved; the temporary function server was stopped. No commit, push,
deployment or physical-device acceptance was performed. The implementation is ready
for review and rebuilt-device QA; this QA scope is not yet closed.

## Physical iPhone acceptance — required before closing

1. On Today, open an incomplete word. Confirm camera is primary and Photo library
   is easy to find. Deny camera access and confirm library selection still works.
2. With Photos permission unset, denied and limited, open the native picker. Select
   an allowed image without a blanket prompt; verify actual-denial Settings recovery.
3. Cancel an empty selection and cancel Choose another from a reviewed public draft.
   Confirm no upload/reservation/XP and the prior preview/visibility survive.
4. Select JPEG, PNG, portrait/landscape rotated HEIC, iCloud-only and large photos.
   Verify upright, unstretched preview, no unintended crop, no metadata in uploaded
   JPEG, and maximum 1600px edge. The original library asset must remain intact.
5. Choose another, retake with camera, toggle visibility and submit. Verify private
   is the default, preview must load, public appears in Discover, private does not,
   and both appear only in the owner's Vocabulary history.
6. Mix camera/library across three words: expect 10, 20, 40 total XP, one streak day
   and one full bonus. Delete and resubmit; verify reversals and no net XP farming.
7. Background during picker/iCloud download/preparation/upload. Resume, kill/reopen
   after upload, and interrupt network around finalize. Confirm one completion,
   useful recovery, no duplicate object or reward, and preserved visibility.
8. Switch accounts/sign out while selection or upload is pending. Confirm no old
   photo, preview, success or XP feedback appears in the next account.
9. Cross local midnight/change persisted timezone while selecting. Reject a newly
   selected old word and a restored old library draft; allow already-uploaded
   recovery. Changing the device clock must not grant gallery eligibility.
10. Check small screens, safe areas, dark mode, large text, VoiceOver labels and
    touch targets. Also verify Android system picker/back, activity recreation,
    photo permission variants and hardware back before Android acceptance.

Physical acceptance is pending. Automated checks do not certify native orientation,
OEM/iCloud behavior, accessibility rendering or actual device interactions.
