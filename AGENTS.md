# Working on Langtify

## Scope

Phase 7 adds the Public Discover Feed on audited Phase 6, explicitly authorized by the user.
Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and
`docs/DECISIONS.md` before changes. Do not begin Phase 8 or add future product rules.

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
- Do not add gallery uploads, ratings, comments, followers, friends, DMs,
  notifications, leaderboards, achievements, subscriptions, Apple/Facebook login or AI image validation.
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
  photo signing, and account/focus/foreground invalidation. Never start reads from
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
  Ratings, blocking and reporting remain later work; public production launch is
  gated on moderation/safety including blocking and reporting.
- Never commit secrets. `EXPO_PUBLIC_*` is public client configuration.
- Generated `ios/`, `android/`, `.expo/`, and `dist/` remain untracked.
- Preserve unrelated user changes. Update documentation when decisions change.

## Verification

Run `npm run check` before handing off a change. For navigation, dependency, or Expo
configuration changes also run `npm run export:check`, `npx expo install --check`,
and `npm run doctor`. For database changes also run `npm run db:test` and
`npm run db:test:integration`, `npm run db:test:challenges`, `npm run db:test:submissions`, `npm run db:test:bootstrap`, `npm run db:test:photo-audit`, `npm run db:test:progress`, `npm run db:test:vocabulary`, `npm run db:test:discover` and `npx supabase db lint --local --level warning` against local development only;
see README for the Docker file-sharing fallback. Tests belong outside `app/`; exercise observable behavior
instead of snapshots or implementation details. Add tests when they protect
meaningful behavior, not merely to mirror trivial code.

Report commands, outcomes, limitations, and physical-device checks still needed.
For auth changes also run `npm run test:auth:integration` against local Supabase.
Bundle export is not a native binary build or a substitute for device testing.
Photo changes must include Storage-policy and recovery/cleanup verification. Keep
the hourly cleanup job documented and tested; use Storage API for physical deletion.

For photo-function changes also run `npm run functions:check`, `npm run functions:lint`
and `npm run functions:test`. Deno imports are pinned separately from the mobile
package; never pull server-only credentials or the decoder into Expo bundles.
