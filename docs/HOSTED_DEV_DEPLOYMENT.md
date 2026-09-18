# Deploying the current repository to Langtify Dev

This is an operator runbook, **not a record of a deployment**. No hosted database,
Google provider, push credential, cron or physical build was changed by this work.
Use only the owned **Langtify Dev** project. The sender implements the approved
at-most-one-provider-attempt contract. Hosted credentials, scheduling and physical
acceptance are deployment gates; no device-delivery guarantee is made.

Before commands, check the project name/reference in the Supabase dashboard, use
a development-only database backup and set `LANGTIFY_DEV_REF` in your shell to that
reviewed reference. Commands below require it to be nonempty. Do not reuse production
credentials, pipe secret output into logs or use debug logging. Existing populated
Dev installs should pause app writes during migration/function rollout and keep a
restorable backup. Failed migration preflights require investigation, not bypass.

## 1. Apply database migrations

Install the locked dependencies, authenticate the CLI and link this checkout to the
reviewed Dev project. Linking does not itself apply schema changes. Inspect migration
history and the dry-run list before the final push. The CLI will request database
credentials securely; do not put passwords into command-line flags/history.

```sh
npm ci
npx supabase login
npx supabase link --project-ref "${LANGTIFY_DEV_REF:?Set the reviewed Dev project reference}"
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Apply all pending migrations in their recorded order, including audits, through
`20260918030000_phase10_lock_order.sql`. Do not use `--include-all`, reset a
hosted DB, or manually replay the original bootstrap on an existing schema.
Preexisting unverified photos or inconsistent historical XP may intentionally stop
an audit migration; review the associated audit document before repairing data.

## 2. Load the development vocabulary seed

Open the **Dev** SQL Editor, paste the contents of `supabase/seed.sql` inside a
transaction and run it once after migrations. It inserts missing development
concepts/terms without overwriting existing catalog edits. The modest English/French
seed supports testing; it is not a production-reviewed vocabulary corpus. Confirm
active reference/target terms and enough distinct concepts at every tested CEFR slot.
Do not run `npm run db:seed` expecting a hosted write: that command is local only.

## 3. Deploy the Edge Functions

Deploy the matching photo authority before opening photo traffic. It retains Auth
JWT verification and server-only image attestation/signing. The scheduler is
closed until both its dedicated job secret and Expo access token are configured.

```sh
npx supabase functions deploy photo-authority --project-ref "${LANGTIFY_DEV_REF:?}"
npx supabase functions deploy notification-scheduler --project-ref "${LANGTIFY_DEV_REF:?}"
```

In the Dev dashboard's Edge Function secrets, generate/store a cryptographically
random 32-byte secret encoded as 64 lowercase hex characters under
`NOTIFICATION_JOB_SECRET`. Store it in the team's secret manager; don't paste it
into source, Expo env, request logs or this runbook. Standard `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` stay in the server environment. Set `EXPO_ACCESS_TOKEN` as an Edge secret and enable Expo enhanced push security
for the reviewed Expo Dev project. Keep this token separate from the cron secret;
never copy it into Expo public env. Configure APNs/FCM credentials through trusted
Expo/EAS provider tooling before scheduling real test recipients.

## 4. Notification send and receipt cron

The following step enables real sends to eligible registered Dev accounts and
receipt polling. Configure trusted provider credentials and controlled test devices
before enabling the cron; leave it unscheduled until then. Supabase Cron with pg_net can invoke
an Edge Function using Vault-managed secrets; see [Supabase's scheduling guide](https://supabase.com/docs/guides/functions/schedule-functions).

In **Dev**, enable Cron (`pg_cron`) and `pg_net` using the dashboard integrations.
Create two Vault secrets using its secure UI: `langtify_dev_notification_url` is
`https://<reviewed-dev-ref>.supabase.co/functions/v1/notification-scheduler`, and
`langtify_dev_notification_job_key` is the same secret as the Edge Function. Verify
the hostname belongs to Dev. Run this SQL only in that project's SQL Editor:

```sql
select cron.schedule(
  'langtify-notifications-dev',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'langtify_dev_notification_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notification-job-key',
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'langtify_dev_notification_job_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
```

Inspect the HTTP response as well as cron execution: scheduling a request is not
proof that the function completed. Monitor attempted/ticketAccepted/rejected/uncertain,
preparationFailures/recordFailures/receiptsChecked/receiptFailures. A ticket is not
device delivery. Each tick claims at most 10 accounts; four single-recipient calls
run concurrently. Verify the configured Edge runtime supports the 120-second job
request budget. Monitor overdue counts for the actual cohort. Failures do not justify
resetting a consumed attempt; historical blocked rows must not be sent as a backlog.
Remove the named job using `cron.unschedule('langtify-notifications-dev')` when testing
ends. Remove any older preparation-only cron before enabling this job.

## 5. Install the existing photo cleanup schedule

On a trusted Node runner, deploy this same checkout and run `npm ci`. Supply a
restricted environment file outside source containing only the **Dev**
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Run one maintenance pass, then install
the existing hourly cron example with correct absolute runner paths:

```sh
node --env-file=/etc/langtify/dev-maintenance.env scripts/cleanup-submissions.mjs
```

See [the cron template](../ops/submissions-cleanup.cron.example). Restrict the file
to the runner account and make sure cron references `dev-maintenance.env` and the
Dev checkout. Alert on failure, nonzero retry counts and missing hourly runs.
Interrupted deletion and expired uploads must be physically removed through the
Storage API. Do not replace this worker with SQL deletion from `storage.objects`.

## 6. Provision a development moderator

Create a real test account through Auth and complete onboarding. In trusted Dev SQL,
follow [moderator operations](MODERATION.md) to insert its exact Auth UUID into
`private.moderators`. Test an ordinary account first, then provision, revoke and
restore the moderator while its session remains active. Ordinary users never grant
roles. Do not put moderator email/UUIDs into the app or public config.

## 7. Configure hosted Auth and mobile environment

Configure email/password confirmation, test mail delivery and the password policy.
Configure Google with the existing Web OAuth client in Supabase, Google's authorized
Supabase redirect URI, and Supabase's exact `langtify://auth/callback` redirect allowlist.
Use [the Google setup steps](../README.md#phase-55-google-authentication); do not enable
manual email-based linking or implicit tokens. Site URL and optional web callback
must use a real owned HTTPS development page. Apple login remains deferred.

In the untracked `.env.local`, put only the Dev API URL and public anon/publishable
key into `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Set the public
`EXPO_PUBLIC_EAS_PROJECT_ID` only after the operator creates/selects the real Expo
Dev project. Google Client Secret, job secret, database password, service key and
APNs/FCM credentials must never use `EXPO_PUBLIC_*`.

For Android registration, configure the Firebase client application with package
`com.langtify.app`, place its `google-services.json` outside source and set
`LANGTIFY_GOOGLE_SERVICES_FILE` to its absolute path. This is the client config, not
an FCM service-account JSON. See [Expo native setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
for trusted EAS/provider credentials. iPhone registration requires appropriate Apple
membership, push capability and provisioning. Credentials/project IDs were not
created here; errors should leave registration retryable and sending disabled.

## 8. Build for physical devices

Use a connected provisioned iPhone with Xcode or an Android phone with USB debugging
and Android Studio/SDK. Builds use the existing `langtify` scheme and `com.langtify.app`
identifiers. After env/plugin/native credential changes, rebuild the native client:

```sh
npm run build:ios:dev
npm run build:android:dev
npm run start:dev -- --clear
```

Run only the platform build needed for the connected device. The first commands
install a native development binary; the last starts Metro for subsequent JS work.
Generated `ios/` and `android/` remain untracked. No App Store/Play Store publishing
is required. Expo Go and JS exports do not validate native Google redirects, camera,
permission dialogs or push registration. The remote sender is testable only after the hosted function, credentials and cron
are configured; no live device notification was sent during local verification.

## 9. Smoke test and record acceptance

Use separate learner A/B and moderator accounts, plus two devices. Complete
[the beta checklist](BETA_CHECKLIST.md), especially account switching with pending
uploads, private photo denial, signing expiry, moderation revocation and midnight.
Record device/OS/build, Dev migration version and pass/fail per item without secrets.
Check consumed attempts, safe provider outcomes and receipt transitions using Dev
test accounts. Deliberately repeat the scheduler and verify there is no same-date
resend. Do not mark hosted/device acceptance complete based on loopback provider
tests. Complete the applicable hosted/device/operations gates before beta release;
Phase 11 remains outside this scope.
