# QA #26/#27 — onboarding and longer preparation states

Presentation and editorial copy only. No new onboarding field, backend contract,
route, dependency, native configuration, stored vocabulary or Phase 11 change.
Preserve prior uncommitted QA work. No commit, push or deployment. Physical iPhone
acceptance remains pending.

## Onboarding hierarchy

The same five decisions remain in the same order: translation language, learning
language, CEFR level, username and timezone. One purpose per step, a clear title,
short supporting sentence and full-width controls replace the generic form layout.
Language rows show the existing native name when it differs. Level rows pair the
existing A1–C2 values/labels with brief self-selection guidance, informed by the
[Council of Europe global scale](https://www.coe.int/en/web/common-European-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale).
These descriptions are interface guidance, not a placement test or new level rule.

A fixed header holds native-feeling Back, five progress segments and accessible
Step n of 5. The compact wordmark appears on the first step only; later steps use
“Your setup”. Sign out remains reachable in the Setup options sheet. A single
Continue/Finish setup button sits in the safe-area footer, outside the scrollable
choices and inside the existing keyboard-avoidance container.

Selection uses a checkmark as well as an indigo outline, with radio accessibility
state and a selection haptic only when the value changes. Text scales and wraps;
no line caps are introduced. Long level lists and small screens scroll while
navigation remains available. The username keeps keyboard Next and normalization.
Timezone presents a city and full region in one card, opening the same searchable
IANA selector. Settings retain that selector's original field presentation.

Existing validation, drafts across Back/Next and token refresh, account-keyed resets,
username-conflict recovery, hardware Back, announcements, busy guards and the single
final `completeOnboarding` request remain. Tabs unlock only after the authoritative
account reload. Existing `MotionView` supplies restrained step transitions and
honors Reduce Motion/background behavior. No new animation system is added.

## Facts and loading design

`src/data/language-facts.ts` contains **eight** concise facts with stable IDs, original
interface wording and source links. `selectLanguageFact(sample)` accepts a numeric
sample so selection can be tested deterministically. Sources were reviewed on
2026-09-26; they are not fetched at runtime or displayed as a lesson.

| Topic                                        | Editorial source                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Spanish opening/closing question marks       | [FundéuRAE](https://www.fundeu.es/recomendacion/interrogacion-y-exclamacion-usos-de-los-signos-ortograficos/)   |
| Japanese writing systems                     | [Agency for Cultural Affairs](https://www.bunka.go.jp/seisaku/kokugo_nihongo/kyoiku/handbook/pdf/en_zensho.pdf) |
| Hangul syllable blocks                       | [National Institute of Korean Language](https://www.korean.go.kr/eng_hangeul/principle/001.html)                |
| Distinct British and American sign languages | [NIDCD](https://www.nidcd.nih.gov/health/american-sign-language)                                                |
| Braille music/maths codes                    | [RNIB](https://shop.rnib.org.uk/blogs/news/eight-essential-braille-facts)                                       |
| Origin of “alphabet”                         | [Merriam-Webster](https://www.merriam-webster.com/dictionary/alphabet)                                          |
| Accents on French capital letters            | [Académie française](https://www.academie-francaise.fr/questions-de-langue)                                     |
| Swedish origin of “tungsten”                 | [Royal Society of Chemistry](https://periodic-table.rsc.org/element/74/tungsten)                                |

`PreparationState` selects once per mount, reserves that exact text's natural
height while hidden from sight/accessibility, then reveals it after **1.5 seconds**.
This accommodates large text without a layout jump at reveal. The fact stays unchanged
through rerenders, theme changes and elapsed time; a new mounted loading session may
select another fact. Unmounting cancels the timer. Work is never delayed to show copy.
Web uses React's hydration snapshot to defer random text insertion until hydration
finishes; native layout reserves the selected text immediately.

The status and secondary fact are centered in a bounded column. A small brand-colored
indicator replaces a dominant spinner. Reduce Motion uses a static dot and skips the
fact entrance; the accessible busy status remains. There is no looping custom animation,
live-region trivia announcement, mandatory reading or dismiss button.

Only two waits use it:

- Account restoration/setup: “Getting things ready…” in `app/session.tsx`, with a
  compact wordmark. Errors remove the loading state/fact and expose existing recovery.
- Initial uncached challenge preparation: “Finding today’s words…” in Today, only
  while no challenge exists. Cached refresh and replacements retain their current UI.

Audit of other loaders leaves ordinary list reads, media, ratings, comments, uploads
and small mutation feedback unchanged. Finishing onboarding keeps its button busy
state; an ensuing account reload can use the shared preparation state if needed.
No request, cache, Auth, Storage, XP or backend behavior is changed.

## Verification

Passed:

- `npm run check`: strict TypeScript, ESLint, formatting and **928 application tests
  across 78 suites**. Added coverage for fixed navigation around scrolling choices,
  first-step-only branding, accessible radio state, native language names, level
  guidance, all five progress values, timezone draft preservation, options/sign-out,
  light/dark controls, delayed/stable fact selection, reserved scalable text, timer
  cleanup, new loading sessions, error recovery and Reduce Motion. Existing validation,
  keyboard Next, hardware Back, save retry, session/account isolation and motion tests
  remain intact. Word replacement explicitly remains free of preparation facts.
- `npm run test:auth:integration`: local Supabase Auth regressions pass, including
  refresh/session identity, one incomplete profile, password policy, email code
  verification/replay/expiry/resend and Google-origin signup protections. This is
  local fixture verification, not hosted Resend delivery or physical acceptance.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** checks.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear` with dotenv disabled and public local fixtures:
  **iOS, Android and web** exports pass, including web server rendering.
- `npm run security:scan`: **485** source/config/bundle files and both decoded
  native Hermes bundles pass; no privileged credentials/server implementation in
  client exports.
- `git diff --check`: passes.

The focused tests caught a missing accessibility flag on the preparation busy
status, which was fixed. Lint caught an immediate effect-driven state update;
fact selection now uses a lazy per-mount value plus React's web hydration snapshot.
No suppression, skipped test or weakened security assertion was introduced.
Existing navigation-fixture, Node module-type and export color-environment warnings
remain. No SQL, RLS, migration, Edge Function or Storage implementation changed in
this batch; those database/function suites were not rerun.

Files changed for this batch: `AGENTS.md`, `app/session.tsx`, `docs/ARCHITECTURE.md`,
`docs/DECISIONS.md`, `docs/COPY_GUIDE.md`, this report, `src/components/ui/screen.tsx`,
`src/components/ui/preparation-state.tsx`, `src/data/language-facts.ts`,
`src/features/onboarding/onboarding-screen.tsx`, `onboarding-steps.tsx`,
`setup-choices.tsx`, `timezone-field.tsx`, `src/features/challenges/today-screen.tsx`,
`tests/onboarding-save.test.tsx`, `tests/preparation-state.test.tsx` and
`tests/today-screen.test.tsx`. Earlier uncommitted QA files are preserved.

Automated layout and accessibility checks do not constitute physical keyboard,
gesture or visual acceptance.

## Physical iPhone checklist

1. Complete all five steps on a small screen; verify choice hierarchy, native names,
   level descriptions, first-step-only compact logo and visible Back/Continue.
2. Change every value, move backward/forward, select/search timezone and open/close
   Setup options. Confirm drafts remain, Sign out remains reachable and no step
   writes setup prematurely.
3. Type an invalid/taken username; verify correction and final-save retry preserve
   the draft. Keyboard Next moves to timezone; footer stays above the keyboard.
4. Finish setup; confirm one server save, normal gated transition into Today and no
   changed language, timezone, challenge or progression behavior. Switch accounts
   during setup/loading and confirm the previous draft never carries over.
5. On a slow connection, inspect account and initial challenge loading: centered
   status, one secondary fact after a short wait, no flicker/rotation or reveal jump.
   Fast loads should finish immediately. Errors should offer existing recovery.
6. Revisit loaded Today, replace a word, rate/comment and paginate elsewhere: no
   trivia or new delay. Background/resume a preparation wait; no fact rotation or
   replay of a completed transition.
7. Check light/dark, VoiceOver, large accessibility text, Reduce Motion, home-indicator
   spacing and small-screen scrolling. Facts should be secondary and never obscure
   controls. Android Back should step backward, then retain its existing first-step
   behavior. Recheck web responsiveness as well.

No new native rebuild or hosted deployment is required for this batch. Reload the
existing compatible development client through Metro. A standalone app still needs
its usual JavaScript/binary distribution path; none was performed here.
