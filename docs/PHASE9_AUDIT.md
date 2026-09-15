# Phase 9 audit — Reporting, Blocking & Moderation

Scope: correctness, privacy, backend authority, durable audit history, concurrency
and account isolation. No Phase 10 work or product-policy changes. Existing Phase 9
implementation files were already uncommitted at audit start and were preserved.

## Findings and fixes

### Medium — Failed queue filter changes retained the wrong rows and cursor

Changing from open to dismissed/resolved updated the selected status before its
request completed. If that request failed, the old queue and Next reports control
remained. Paging then sent the previous status's timestamp/UUID with the newly
selected status, potentially skipping reports or presenting cases under the wrong
filter. This did not bypass moderator authorization, but it compromised reliable
case review.

Reproduced with an open page containing a next-page cursor, a rejected dismissed
request, and the old reports still rendered. Clear the queue and its cursor before
filter/page requests and explicit refresh. Failure now requires refresh from the
selected status's first page. The regression fails before the fix and passes after.

### Low — A delayed image error cleared a newer moderator preview

The old Image component's error handler called `setPhoto(null)` unconditionally.
After a case reload installed a new signed preview, a delayed old error could remove
the successful new preview. This was an availability/state-correctness defect; it
did not disclose a private photo or install another account's state.

Reproduced by retaining an old image error callback, renewing the preview, and then
invoking the retained callback. Image errors and expiry callbacks now clear only
the exact preview instance they belong to. The regression fails before the fix and
passes after; the existing independent expiry and account-switch tests still pass.

### Authority review and expanded evidence

No backend authorization, RLS, XP, audit-idempotency or supported-RPC lock-order
defect was reproduced. This conclusion is limited to reviewed paths and tested
interleavings, not a proof against every possible workload.

- Ordinary users cannot self-provision moderators through metadata, raw REST,
  private helpers or caller identity overrides. Backend role checks protect queue,
  case, audit and moderator signing reads/writes.
- Reports/audit/block tables deny ordinary raw REST reads and mutations. Reporter
  IDs are omitted from case/queue projections. Controlled reasons, detail bounds,
  self-target denial and unique open cases resist obvious report abuse.
- Directed blocks exclude both accounts' public content, signatures and ratings.
  Stale unblock IDs cannot erase a newer block. Owner-only learning remains available.
- Removal cannot be cleared through owner visibility changes. Restrictions deny
  public feed/signing/rating/publication through already-issued sessions. Private
  finalization remains valid and is credited only by existing completion authority.
- Moderator inspection accepts report IDs only and verifies a completed, attested
  object/version. Tests now explicitly try an unreported private photo ID, caller
  path overrides, the owner-preview endpoint and direct Storage signing as a moderator.
  None grants arbitrary private-photo access.
- Moderator request UUIDs are actor-scoped and immutable. Concurrent retries create
  one audit event, conflicting request identities fail, and an old retry cannot
  undo a newer restore. Raw audit UPDATE/DELETE are denied.
- Added both revocation/admission lock orders: an admitted write commits before
  revocation; a write waiting behind revocation is denied without an audit row or
  state change. Existing sessions immediately fail subsequent role-checked calls.
- Added overlapping reciprocal ratings, removal and publication rounds. Expected
  eligibility denials occur without deadlocks; account revision locks remain ordered
  before submission locks. Existing stale-snapshot tests still reject obsolete writes.
- Added deletion versus restoration: deleting content cannot be restored or newly
  signed; deletion intent preserves XP until normal retirement reconciles it.
  Public restriction/removal alone leaves the ledger unchanged.
- Added hard target-account deletion: all case/audit snapshots survive, previews
  disappear, and the moderator can still resolve the retained case.
- Existing session/account/focus guards pass. A new retained foreground-callback
  regression confirmed that the shared hook already ignores an expired focus
  lifetime; no hook modification was necessary.

No database migration, RLS policy, function implementation, authentication flow,
dependency, XP/streak rule or public-eligibility rule changed in this audit.

## Verification

Commands run against local development only. Suites using the shared database ran
sequentially; bootstrap used a separate disposable database. No hosted deployment
or real moderator provisioning was performed.

| Command                                                                       | Result                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run check`                                                               | Typecheck, lint and formatting pass; 299 application tests in 33 suites                    |
| `npx supabase test db /private/tmp/langtify-db-tests/`                        | 610 assertions in 14 SQL files pass                                                        |
| `npm run db:test:safety`                                                      | 14 real Auth/Storage, privacy, concurrency, revocation, deletion and expiry groups pass    |
| `npm run db:test:ratings`                                                     | 7 integration/concurrency groups pass                                                      |
| `npm run db:test:discover`                                                    | 7 feed/privacy/pagination/signing groups pass                                              |
| `npm run db:test:submissions`                                                 | 10 Auth/Storage/lifecycle/recovery groups pass                                             |
| `npm run db:test:photo-audit`                                                 | 6 byte-verification/Storage/recovery groups pass                                           |
| `npm run db:test:bootstrap`                                                   | 13 ordered bootstrap/nonempty replay groups pass                                           |
| `npx supabase db lint --local --level warning`                                | No schema errors                                                                           |
| `npm run functions:check`, `npm run functions:lint`, `npm run functions:test` | Pass; 6 Deno tests; moderator endpoint additionally covered through real local integration |
| `npx expo install --check`, `npm run doctor`                                  | Compatible dependencies; 21/21 Doctor checks pass                                          |
| `npm run export:check -- --clear`                                             | iOS, Android and web exports pass                                                          |
| `npm run security:scan`                                                       | Source/config and web/decoded Hermes bundles pass                                          |
| `git diff --check`                                                            | Pass                                                                                       |

SQL uses the README's Docker file-sharing fallback, with fresh copies of all
repository SQL tests. The safety suite verifies actual 60-second Storage expiry
before deleting its reported-image fixture, so missing-object behavior cannot
masquerade as successful expiry. Temporary users, objects and durable case/audit
fixtures are cleaned up. Existing module-type/color warnings are informational.

## Remaining risks and closure

The code audit has no remaining reproduced security or correctness blocker after
the two UI fixes. Phase 9 is safe to close as an implementation/audit milestone,
subject to the outstanding release acceptance below. This does not authorize a
public-production launch or Phase 10.

- Hosted migration/function deployment and iOS/Android physical-device/admin
  acceptance remain pending; exports are not native builds. Follow
  [Phase 9 acceptance](PHASE9_VERIFICATION.md) and [moderator operations](MODERATION.md).
- Previously issued 60-second bearer capabilities and admitted read snapshots cannot
  be recalled instantly; downloaded images cannot be recalled. New reads/signatures
  and mutation admission recheck current backend authority.
- Cancellation does not roll back a server transaction already accepted. Current
  state and immutable request/audit history remain the recovery authority.
- Moderation staffing, content/escalation procedures, membership reviews and handling
  of sensitive retained report details remain operational responsibilities.
- Production load and hot-account contention require measurement. Passing finite
  concurrency tests does not prove absence of every deadlock involving arbitrary
  privileged SQL or establish capacity. No new quotas or reputation policy is added.
