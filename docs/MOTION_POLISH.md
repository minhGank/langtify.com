# Motion and native interaction polish

This is the explicitly authorized motion/interaction pass over the existing app.
It does not start Phase 11, change product rules, or authorize a commit, push or
deployment. Physical iPhone acceptance remains pending.

## Design principles

Use motion for continuity, meaningful state changes and acknowledgement. Keep
navigation, scrolling, text entry and routine loading calm. There are no confetti
effects, repeating animations, delayed navigation or animated list entrances.
The existing color semantics, accessible text and state labels remain authoritative
visual cues; vibration and animation are supplementary.

`src/lib/motion.ts` centralizes the values used by shared presentation helpers:

| Interaction          | Configuration                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| Button press/release | 140 ms, scale 0.98 → 1                                                        |
| Small state change   | 220 ms, opacity 0.72 → 1                                                      |
| Onboarding step      | 260 ms, directional translation 20 px → 0 and opacity                         |
| Confirmed reward     | Scale 0.97 → 1; spring damping 22, stiffness 240, mass 0.8; overshoot clamped |

Timing uses cubic ease-out. React Native `Animated` runs opacity/transforms with
`useNativeDriver: true` and `isInteraction: false`; no animated layout dimensions,
expensive blur/shadows, frame-loop React updates or new animation framework.
Animation values persist for the component lifetime. Existing native navigation
retains platform timing.

## Haptic contract

`src/lib/haptics.ts` is the only adapter to Expo Haptics. Ordinary buttons do not
vibrate by default. Mutation feedback runs inside the existing accepted-response
guards; it is never inferred from a mounted screen or cached server value.

| Trigger              | Feedback and admission                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rating               | Selection feedback after the accepted response confirms a changed requested score. Pending, failed, unchanged, reconciled uncertain and obsolete responses remain silent.                                      |
| Follow/unfollow      | Light confirmation after a changed authoritative relationship is accepted. Both target and viewer profile projections must remain eligible.                                                                    |
| Username save        | Success after a valid changed save and authoritative account refresh, immediately before the guarded return to Profile.                                                                                        |
| Avatar save          | Success after the current account/focus accepts finalized avatar state. Choosing or cancelling a photo does not confirm a save.                                                                                |
| Avatar removal       | Light confirmation after accepted removal.                                                                                                                                                                     |
| Comment post/delete  | Light confirmation after the focused mutation is accepted, with a visible “Comment posted.” or “Comment deleted.” acknowledgement.                                                                             |
| Choice controls      | Selection feedback only when an enabled `ChoiceField` value, timezone selection or Vocabulary/Past Words CEFR filter actually changes. This acknowledges a local selection, not a backend save.                |
| Photo completion     | One success signal after this active submission attempt receives completed finalization. Same presentation lifetime, gateway and submission ID are checked. The later XP read does not add a second vibration. |
| Photo Delete/Discard | Warning when the user explicitly confirms the destructive action in its existing confirmation sheet. This acknowledges intent; it does not claim deletion has finished.                                        |

There is no vibration for opening a rating palette, opening an inbox entry, marking
notifications read, tab changes, normal navigation, refresh, scrolling, passive
progress changes or text input. Already-completed reservations, restored completed
photos and lost-acknowledgement reconciliation do not replay photo rewards.

iOS uses selection, light impact, success and warning APIs. Android uses its
semantic native haptics (`Segment_Tick`, `Virtual_Key`, `Confirm`, `Reject`). Web
does not vibrate. Background calls, unavailable native modules, rejected native
calls and unsupported hardware fail silently without blocking the action. The
device/OS ultimately controls whether a requested haptic can be felt; there is no
custom vibration fallback or request to override system preferences.

## Guided onboarding

The same five required fields now appear as five steps:

1. Reference language — the language used for translations.
2. Target language — the language being learned.
3. Current CEFR level.
4. Username.
5. Timezone and Finish setup.

A labelled progress indicator, one primary continuation action and directional
transitions clarify progression. Back retains the draft. Android system Back
returns to the preceding step, with normal platform behavior at the first step;
Back is held while the atomic save is pending. Username focuses on entry and its
keyboard Next action advances after validation. Step changes dismiss the keyboard,
reset only this form's scroll position and announce the new step for accessibility.

Each step validates its existing field; Finish validates the whole unchanged
payload. A backend username collision returns to that step without discarding the
other choices. One in-flight ref guard prevents duplicate saves. Account changes
discard the prior form, while same-user token refresh retains its draft. Completion
still requires the same RPC and authoritative account reload; no optimistic route
unlock, new onboarding question or partial backend save is introduced.

## Photo completion and progress

The reviewed local photo stays visible while finalization and the existing
authoritative refresh install completed metadata and remote pixels. Submission
controls stay busy through that reconciliation. Cleanup of the local draft still
follows the completed/deleting state returned by the existing recovery read.

Only an explicitly acknowledged finalization enables fresh completion motion.
Leaving/backgrounding the photo screen, changing its gateway or retiring its
account cache invalidates that presentation acknowledgement. Opening an old photo,
revisiting a completed challenge or recovering an uncertain result remains calm.

The existing server XP receipt determines the presentation tier:

- Word completion: small confirmation and the returned word XP.
- Full challenge: “Daily Challenge Complete” and the returned full bonus, with a
  modest spring transition.
- Streak milestone: a stronger heading/sparkle emphasis and the returned milestone
  amount, using the same restrained spring family.

There is one photo success haptic, not a second delayed XP vibration. No amount,
streak qualification or level is calculated as a client reward. Historical captures
retain their existing word-only XP rules. Reversals, retries, account changes and
receipt reconciliation do not create or multiply XP or replay a consumed reward
transition. No celebration modal delays the user's next action.

Today retains stable challenge-slot and progress components so actual replacements,
completion counts, XP and level changes can transition without remounting the whole
panel. Vocabulary/photos, capture authority and deletion reversal remain unchanged.

## Other interactions and navigation

Confirmed rating chips, explicit follow-count changes, accepted avatar changes and
comment acknowledgements use small transitions. Inbox read labels and the unread
badge transition only when their displayed value changes. Search Words/People
switching has a small category-control transition; search results and long feeds do not
animate item by item. Initial mounting and returning to unchanged cached values
do not trigger entrances.

Shared buttons have restrained press/release feedback while preserving disabled,
busy and accessibility states. Destructive operations still require their existing
confirmation. Confirmed comment removal is immediate; animation never retains a
deleted or newly unauthorized row for an exit effect.

Native stack navigation remains in place for post, profile, word, connection and
settings routes, including native back behavior and existing direct-entry fallbacks.
Root navigation explicitly uses platform-default transitions with motion enabled
and none under Reduce Motion. Existing action sheets and rating palettes keep
tap-based dismissal, accessible escape and Android Back; no undiscoverable custom
gesture or navigation delay is added.

## Loading, caching and accessibility

Static neutral loading placeholders improve initial Discover/Vocabulary presentation
without shimmer or additional data requests. Loaded content stays visible during
small updates and existing reconciliation. Current pull-to-refresh, bounded pages,
signed-media expiry and cached scroll behavior are preserved.
Search cancels obsolete queries immediately; placeholders cover genuine initial
or changed-query loads rather than leaving results for the previous query active.

Motion never controls requests, refresh timing, authorization, navigation eligibility
or mutation admission. No elapsed-time-only fetching, polling, new cache or persisted
celebration state is added. Existing account/session/focus cancellation, cache
retirement, response ordering and background policy continue to govern data.

`useReducedMotion` shares one OS preference subscription and conservatively disables
motion until the preference is known. Enabling Reduce Motion stops active shared
animations and renders the final state immediately. Disabling it does not replay an
old trigger. Backgrounding stops shared motion without a queued resume animation.
Texts, controls, progress labels and results remain available throughout. No
animation moves accessibility focus or replaces a textual success/error state.

## Dependency and native rebuild

The only added dependency is Expo SDK 57-compatible `expo-haptics ~57.0.3`, installed
through Expo's dependency installer. The Expo SDK itself, backend functions,
migrations, secrets and notification delivery contract are unchanged by this pass.
No deployment is required for these presentation changes.

No Expo config plugin was added. Native autolinking includes the module; its Android
manifest declares `VIBRATE` automatically, without a runtime permission prompt.
The adapter uses Android's semantic haptic API instead of custom vibration patterns.
See the [Expo SDK 57 Haptics documentation](https://docs.expo.dev/versions/v57.0.0/sdk/haptics/).
The earlier seven Expo SDK patch alignment changes remain in the working tree;
this pass does not upgrade to a different Expo SDK.

An iPhone development rebuild is required to include the native haptics module.
For the existing free Personal Team workflow, run from the repository root:

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo prebuild --platform ios
LANGTIFY_DISABLE_IOS_PUSH=1 npm run build:ios:dev
```

If starting Metro separately:

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npm run start:dev -- --clear
```

Generated native files remain untracked. The local flag still only disables iOS
push capability for Personal Team acceptance; normal builds without the flag remain
push-capable. In-app notifications continue to work independently. Android native
development clients also need rebuilding to include the new native module. A
JavaScript export alone does not validate native compilation or physical haptics.

## Verification and acceptance

Local verification on 2026-09-25:

| Command                                     | Result                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                             | Passed: TypeScript, zero-warning ESLint, formatting and 795 tests across 67 suites                                        |
| `EXPO_NO_DOTENV=1 npm run doctor`           | 21/21 checks passed                                                                                                       |
| `EXPO_NO_DOTENV=1 npx expo install --check` | Dependencies up to date for SDK 57                                                                                        |
| `npm run export:check -- --clear`           | iOS, Android and web passed; dotenv disabled and nonfunctional local/public Supabase fixtures used                        |
| `npm run security:scan`                     | Passed: 436 source/config/bundle files, including two decoded Hermes bundles                                              |
| `npm audit --audit-level=high`              | Passed high/critical gate; 14 existing moderate findings remain; no forced fixes                                          |
| `git diff --check`                          | Passed                                                                                                                    |
| `npm run db:test`                           | Blocked before tests: Docker rejected the unshared `/Applications/langtify.com/supabase/tests` mount (container exit 125) |

The local DB sequence stopped on that first failure, as previously instructed.
The queued `db:test:submissions`, `db:test:photo-audit`, `test:auth:integration` and
`db:test:integration` commands did not run. Permission to use the README's documented
temporary-directory fallback remains pending. No migration, reset, hosted write or
deployment was attempted. There are no schema or Edge Function changes in this pass.

During verification, the attempted Search debounce retention was removed because it
delayed cancellation of obsolete reads. The shared press hook no longer subscribes
to background events when reduced/disabled, and tests cover interruption reset.
Entrance-only motion ignores later changes to its initial entrance flag so unrelated
parent renders cannot truncate an acknowledged reward. All final application checks
include these corrections; no existing tests were skipped or weakened.

Behavioral coverage includes reduced-motion changes, intended/silent haptic paths,
onboarding back/keyboard/save behavior, stale and duplicate mutation responses,
completed-photo recovery, reward replay suppression, loading continuity and existing
navigation/account regressions. Database/Edge Function behavior is unchanged; native
feel, frame pacing and hardware behavior still need device acceptance.

Physical iPhone checklist:

- Rebuild with the Personal Team flag; confirm startup, camera/library selection and
  in-app notifications still work without iOS remote-push capability.
- Try light/dark mode, large text and VoiceOver through all five onboarding steps;
  verify progress announcements, keyboard Next, Back, invalid username and retry.
- Feel rating, follow/unfollow and profile/avatar save confirmation. Reopen screens,
  cancel sheets and repeat an unchanged selection; these should stay silent.
- Complete one daily word, then 3/3; verify readable server XP, a brief acknowledgement,
  retained preview and responsive controls. Check a milestone when an eligible
  server-backed fixture/account is available.
- Capture a Past Word and verify only its existing historical word XP presentation.
- Interrupt an upload, lose a response, return from background and retry. Confirm
  recovery stays usable and no old reward or haptic replays on revisit/account switch.
- Confirm photo deletion/discard and comment deletion remain immediate after their
  required authority steps. Failed writes must not look successfully completed.
- Rate quickly, follow/unfollow, post a comment and mark inbox entries read; verify
  correct pending states, counts, readable notices and no duplicate writes.
- Scroll Discover/Search/Vocabulary/Past Words with cached data and slow networking;
  verify stable content, smooth scrolling, retained position and no repeated entrances.
- Use edge-back and visible back controls through post/profile/connection/settings
  routes. Verify existing deep-link fallback behavior.
- Enable Reduce Motion during an animation and continue using the app. Confirm
  instant final states, usable controls and no replay when the setting is disabled.
- Check normal system haptic settings and unsupported/silent behavior. Haptics must
  never be required to understand a result or complete an action.

Android system Back, native haptic feel and web fallback also require platform QA.
This pass is not visually or physically accepted until the iPhone checklist passes.
