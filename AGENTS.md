# Working on Langtify

## Scope

Phase 5 authorizes daily progress, streaks, XP and levels on audited Phase 4.
Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and
`docs/DECISIONS.md` before changes. Do not begin Phase 5.5 or Phase 6, or add future product rules.

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
- Do not add gallery uploads, feed, ratings, comments, followers,
  notifications, leaderboards, achievements, subscriptions, social login or AI image validation.
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
- Never commit secrets. `EXPO_PUBLIC_*` is public client configuration.
- Generated `ios/`, `android/`, `.expo/`, and `dist/` remain untracked.
- Preserve unrelated user changes. Update documentation when decisions change.

## Verification

Run `npm run check` before handing off a change. For navigation, dependency, or Expo
configuration changes also run `npm run export:check`, `npx expo install --check`,
and `npm run doctor`. For database changes also run `npm run db:test` and
`npm run db:test:integration`, `npm run db:test:challenges`, `npm run db:test:submissions`, `npm run db:test:bootstrap`, `npm run db:test:photo-audit`, `npm run db:test:progress` and `npx supabase db lint --local --level warning` against local development only;
see README for the Docker file-sharing fallback. Tests belong outside `app/`; exercise observable behavior
instead of snapshots or implementation details. Add tests when they protect
meaningful behavior, not merely to mirror trivial code.

Report commands, outcomes, limitations, and physical-device checks still needed.
Bundle export is not a native binary build or a substitute for device testing.
Photo changes must include Storage-policy and recovery/cleanup verification. Keep
the hourly cleanup job documented and tested; use Storage API for physical deletion.

For photo-function changes also run `npm run functions:check`, `npm run functions:lint`
and `npm run functions:test`. Deno imports are pinned separately from the mobile
package; never pull server-only credentials or the decoder into Expo bundles.
