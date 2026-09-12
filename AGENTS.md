# Working on Langtify

## Scope

Phase 3 authorizes the shared vocabulary catalog, daily challenge generation,
replacement history and Today UI, building on completed Phase 2 authentication. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, and `docs/DECISIONS.md` before changes. Do not begin Phase 4
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
- Do not add camera/uploads/buckets, streaks, feed, ratings, comments, followers,
  notifications, social login, or fabricated business logic in Phase 3.
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
`npm run db:test:integration`, `npm run db:test:challenges`, `npm run db:test:bootstrap` and `npx supabase db lint --local --level warning` against local development only;
see README for the Docker file-sharing fallback. Tests belong outside `app/`; exercise observable behavior
instead of snapshots or implementation details. Add tests when they protect
meaningful behavior, not merely to mirror trivial code.

Report commands, outcomes, limitations, and physical-device checks still needed.
Bundle export is not a native binary build or a substitute for device testing.
