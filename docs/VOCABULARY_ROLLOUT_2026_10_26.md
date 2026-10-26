# Vocabulary inactive staging rollout — 2026-10-26

Targets: Dev `ssuyyrfncvyqsgkirvpq`, Production `lfdgjewypbhukjrtwsef`.
The operator explicitly approved encrypted backup retention and the reviewed scoped
migrations and inactive staging imports. Activation was not authorized during this
staging operation. Subsequent owner approval and activation are recorded separately
in [the activation record](VOCABULARY_ACTIVATION_REVIEW.md).

## Backup retention and recovery

Both the October 22 verified backups and fresh October 26 pre-rollout backups were
retained on October 26. Full fresh archives restored with original ownership and ACLs
in isolated PostgreSQL 17.6 containers with networking disabled. Table counts matched
for 78 Dev and 73 Production tables across public/private/Auth/Storage metadata and
migration history. Restored schema, effective client/service permissions, constraints,
indexes, policies, functions, triggers and Storage configuration matched the live
pre-rollout fingerprints. Dev's existing pg_cron/pg_net dependencies were loaded only
inside the disposable restore environment; Cron execution was disabled.

The October 26 recovery points are in these separate directories:

- Dev: `/Users/station1/Library/Application Support/Langtify/backups/2026-10-26-vocabulary-rollout/dev/`
- Production: `/Users/station1/Library/Application Support/Langtify/backups/2026-10-26-vocabulary-rollout/production/`

Each contains `database.dump.enc` and a nonsecret `verification.json` receipt with
archive hashes, restoration results and retention timestamp. Keys are separate files:

- `/Users/station1/Library/Application Support/Langtify/backup-keys/2026-10-26-vocabulary-rollout/dev.key`
- `/Users/station1/Library/Application Support/Langtify/backup-keys/2026-10-26-vocabulary-rollout/production.key`

The earlier pair uses batch directory `2026-10-22-vocabulary-preflight` under the same
backup/key roots. Retention starts October 26, 2026 and continues until the operator
explicitly removes the archives; no automatic deletion is scheduled. Do not delete a
key while its backup is retained. Nothing was uploaded to GitHub or another service.
These are local recovery copies, not protection against losing the Mac and its keys.

All backup/key directories are owner-only `0700`; archive, receipt and key files are
`0600`, owned by the macOS user `station1`, with ACLs removed. Ownership and permission
checks passed after writing. Encryption is AES-256-CBC with PBKDF2-SHA256 (200,000
iterations), independently generated 256-bit passphrases and an HMAC-SHA256 over each
encrypted archive. Decryption reproduces each restore-verified plaintext SHA-256.
Key values are never printed, placed in shell arguments or stored in this repository.

Recovery preparation, for an explicitly chosen environment:

```sh
umask 077
LANGTIFY_RECOVERY_ENV=dev # or production; choose deliberately
LANGTIFY_RECOVERY_BASE="$HOME/Library/Application Support/Langtify"
LANGTIFY_RECOVERY_BATCH=2026-10-26-vocabulary-rollout
LANGTIFY_RECOVERY_ARCHIVE="$LANGTIFY_RECOVERY_BASE/backups/$LANGTIFY_RECOVERY_BATCH/$LANGTIFY_RECOVERY_ENV/database.dump.enc"
LANGTIFY_RECOVERY_RECEIPT="$LANGTIFY_RECOVERY_BASE/backups/$LANGTIFY_RECOVERY_BATCH/$LANGTIFY_RECOVERY_ENV/verification.json"
LANGTIFY_RECOVERY_KEY="$LANGTIFY_RECOVERY_BASE/backup-keys/$LANGTIFY_RECOVERY_BATCH/$LANGTIFY_RECOVERY_ENV.key"
python3 - "$LANGTIFY_RECOVERY_ARCHIVE" "$LANGTIFY_RECOVERY_RECEIPT" "$LANGTIFY_RECOVERY_KEY" <<'PY'
import hashlib, hmac, json, pathlib, sys
archive = pathlib.Path(sys.argv[1]).read_bytes()
receipt = json.loads(pathlib.Path(sys.argv[2]).read_text())
key = bytes.fromhex(pathlib.Path(sys.argv[3]).read_text().strip())
mac_key = hmac.new(key, b'archive-integrity-key', hashlib.sha256).digest()
assert hashlib.sha256(archive).hexdigest() == receipt['encrypted_sha256']
assert hmac.compare_digest(hmac.new(mac_key, archive, hashlib.sha256).hexdigest(), receipt['hmac_sha256'])
print('Encrypted archive integrity verified; no key displayed.')
PY
```

Only after successful HMAC verification, decrypt into a private temporary directory:

```sh
LANGTIFY_RECOVERY_WORK=$(mktemp -d /private/tmp/langtify-recovery.XXXXXX)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass "file:$LANGTIFY_RECOVERY_KEY" -in "$LANGTIFY_RECOVERY_ARCHIVE" \
  -out "$LANGTIFY_RECOVERY_WORK/database.dump"
python3 - "$LANGTIFY_RECOVERY_WORK/database.dump" "$LANGTIFY_RECOVERY_RECEIPT" <<'PY'
import hashlib, json, pathlib, sys
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() == json.loads(pathlib.Path(sys.argv[2]).read_text())['dump_sha256']
print('Plaintext checksum verified.')
PY
```

Use `pg_restore --exit-on-error --single-transaction` first against an isolated recovery
instance with compatible platform extensions and role names. Preserve owners/ACLs;
Dev needs pg_cron/pg_net preloads. Keep Cron disabled and the restore network-isolated
until all destinations and side effects are reviewed. Local restoration requires the
managed event-trigger owner to have suitable superuser fixture rights; do not change
managed hosted role privileges as a workaround. Inspect restoration errors, row counts,
migration history, policies, effective privileges and Storage guards before approving
any live recovery. Remove temporary plaintext after verification/use.

Database archives include Storage metadata, not Storage object bytes, and do not
include cluster-role passwords or hosted Auth/OAuth/SMTP/Edge settings. A full restore
can lose activity after the recovery point; it is not an automatic rollback command.
For a failed atomic migration/import, verify transaction rollback first. For an uncertain
acknowledgement, re-read history/catalog and reconcile existing UUIDs before any retry.

## Committed database migrations and staging results

Immediately before each environment's writes, its project name/ref/health, full migration
history, catalog and schema/security fingerprint were rechecked. Catalog/history matched
the reviewed October 22 baseline exactly. Source migration hashes matched the reviewed
artifacts. Every migration committed with its history record in the same transaction;
post-commit schema/security matched the exact fresh local restore rehearsal.

Dev committed, in order:

1. `20261005000000_explicit_service_role_rpc_grants`
2. `20261005010000_explicit_service_role_table_grants`
3. `20261013000000_vocabulary_photo_guidance`
4. `20261020000000_bounded_challenge_selection`

Production committed, in order:

1. `20261013000000_vocabulary_photo_guidance`
2. `20261020000000_bounded_challenge_selection`

Production then received only the missing English/French language rows with
server-generated UUIDs. No Dev fixtures were seeded there. Dev now has 35 tracked
migrations; Production has 33, explicitly excluding storage-cleanup coordination
`20261003000000` and account deletion `20261012000000`.

Both final dry-runs had zero technical blockers/conflicts, preserved all 243 release
blockers, and proposed exactly 60 concepts / 120 terms / 120 localized guidance rows.
The exact hash-bound SQL was executed using each target's freshly read identities.

| Result                                | Dev       | Production |
| ------------------------------------- | --------- | ---------- |
| Pilot concepts inserted               | 60        | 60         |
| English/French terms inserted         | 120       | 120        |
| English/French guidance rows inserted | 120       | 120        |
| Pilot concepts inactive               | 60 / 60   | 60 / 60    |
| Pilot terms inactive                  | 120 / 120 | 120 / 120  |
| Total concepts after import           | 96        | 60         |
| Total terms after import              | 192       | 120        |
| Total guidance rows after import      | 120       | 120        |
| Identity-aware repeat-plan inserts    | 0         | 0          |

Dev's original 36 concept UUIDs and 72 terms are unchanged. Both environments passed
exact manifest/translation/CEFR/guidance comparisons and relationship checks. Guidance
inherits parent-concept eligibility; it has no independent active flag. Existing
languages and unrelated catalog rows were preserved. Import execution did not change
schema, effective permissions, policies, functions, triggers or Storage configuration.
Both private buckets, their limits, policies and deletion guards matched the rehearsal.

Final import-plan SHA-256 values:

- Dev: `8e9f40ef434f7d4c45787a1b0e83b321ee182494734349ca807aa9a9a965e1aa`
- Production: `30f8e09f9441dd81f6eb736157aab787b940ef6fcc5746e13fa3a8953be4f819`

Nonsecret receipts preserve the new concept/term identities, links, migration histories
and exact artifact hashes:

- [Dev receipt](../data/vocabulary/staging-receipts/2026-10-26.dev.json)
- [Production receipt](../data/vocabulary/staging-receipts/2026-10-26.prod.json)

A future repeat import must start with a fresh target snapshot and reconcile these
existing identities; do not replay stale insert SQL or generate replacement UUIDs.

## Remaining activation gates and scope

Nothing was activated. All 243 manifest/editorial/coverage/localized-copy release
blockers remain reported. Concept-meaning approval was not extended to independent
translation, CEFR, accessibility or copy approval. Production has no active vocabulary
concepts/terms, so this is staging, not a live launch catalog. Activation requires a
separate reviewed operation and explicit authorization after those gates are resolved.

Existing authenticated raw catalog SELECT policies permit reading inactive concepts
and terms. Daily selection/Explore exclude them, and inactive photo guidance is hidden.
This unchanged behavior is documented; staging is not a confidential editorial store.

No Production account deletion, cleanup coordination, cleanup worker, Cron, Edge
Function deployment, Auth/OAuth/SMTP change, EAS build, commit or push occurred. Dev's
existing cleanup setup was unchanged. No privileged credential or encryption key
was placed in the repository or printed, and no backups/keys were uploaded.

## Final verification and cleanup

- `npm run check`: TypeScript, ESLint, formatting and **1,048 tests / 91 suites** pass.
- Catalog/deployment tooling regression tests: **12 pass**.
- Fresh full backup restores: original owners/ACLs, all checked table counts and
  exact schema/security fingerprints match both hosted sources.
- Every committed migration matches its fresh local rehearsal fingerprint; final
  import checks confirm exact content/links, unchanged unrelated rows, 60 inactive
  concepts and 120 inactive terms per environment, and zero-insert repeat plans.
- Credential scan: **611 files and both existing decoded Hermes bundles** pass.
  This operation did not generate a new native binary or claim device verification.
- `git diff --check` passes. Existing unrelated uncommitted work was preserved.
- Both retained backup batches were independently HMAC/decryption/checksum-verified
  again. Temporary plaintext dumps and the two task-owned offline restore containers
  were removed afterward; encrypted archives and separate keys remain retained.

No infrastructure/import blocker remains for this completed staging operation.
Activation and overall release readiness are separate: the 243 release gates remain,
and existing dependency/audit or signing/device prerequisites were not waived by this
operations rollout.
