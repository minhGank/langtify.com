# Working on Langtify

## Scope

Phase 4 authorizes camera capture, private photo storage, submissions, visibility
and deletion, building on audited Phase 3. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, and `docs/DECISIONS.md` before changes. Do not begin Phase 5
or implement future product rules merely because they are documented.

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
- Do not add gallery uploads, streaks, feed, ratings, comments, followers,
  notifications, social login, or AI image validation in Phase 4.
- Keep the photo bucket private. Submission completion, identity and deletion
  must be backend-authoritative. Preserve trusted byte verification, version-bound
  attestations, commit-time object guards and function-only fixed-lifetime signing. Never put cleanup credentials in public env.
- Derive challenge identity/date/configuration and replacements entirely in backend RPCs.
- Preserve concept-level assignment history and immutable challenge snapshots.
- Supabase/PostgreSQL is authoritative. Use RLS, constraints and atomic writes for
  onboarding; never trust a client completion flag or expose service-role keys.
- Keep migrations, database types, seed and database tests consistent.
- Do not invent product rules. Record unresolved questions and obtain requirements
  when future work depends on them.
- Never commit secrets. `EXPO_PUBLIC_*` is public client configuration.
- Generated `ios/`, `android/`, `.expo/`, and `dist/` remain untracked.
- Preserve unrelated user changes. Update documentation when decisions change.

## Verification

Run `npm run check` before handing off a change. For navigation, dependency, or Expo
configuration changes also run `npm run export:check`, `npx expo install --check`,
and `npm run doctor`. For database changes also run `npm run db:test` and
`npm run db:test:integration`, `npm run db:test:challenges`, `npm run db:test:submissions`, `npm run db:test:bootstrap`, `npm run db:test:photo-audit` and `npx supabase db lint --local --level warning` against local development only;
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
