# Moderator operations — Phase 9

This is an internal safety interface, not a public social feature. Production launch
requires a deployed/tested build and an operational moderation process. Local tests
neither provision a real moderator nor establish release readiness.

## Deploy and provision

1. Apply ordered migrations through `20260917000000_phase9_safety.sql`. Review backup,
   lock duration and nonempty-data migration timing for the intended environment.
2. Deploy the matching `photo-authority` function, then the app. Keep the bucket
   private, the current Auth settings and the hourly submission cleanup job intact.
3. Choose an existing verified, onboarded Supabase Auth user through trusted operator
   records. Use the intended project's SQL editor or another trusted administrative
   connection. Replace the UUID placeholder below; do not put it or administrative
   credentials in public environment variables or an app provisioning screen.

```sql
-- Replace the placeholder with the verified operator's actual Auth UUID.
begin;
insert into private.moderators(user_id)
select u.id
from auth.users u
join public.profiles p on p.id=u.id
where u.id='REPLACE_WITH_MODERATOR_AUTH_UUID'::uuid
  and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=now())
  and p.onboarding_completed_at is not null
on conflict(user_id) do nothing;
commit;
```

Verify that one intended member exists using the trusted connection. Sign in through
the existing password/Google flow, open Profile and refresh safety status if needed.
Only backend membership enables Moderation; `user_metadata`, caller booleans, route
knowledge and frontend UI cannot grant permission. Restricted/banned/deleted moderator
accounts are denied. Review operator membership routinely and keep grants minimal.

Revoke the membership through the trusted connection:

```sql
delete from private.moderators
where user_id='REPLACE_WITH_MODERATOR_AUTH_UUID'::uuid;
```

Future moderator RPC/signing calls fail with the existing session. An already admitted
write holds its membership row until its transaction finishes. The app rechecks role
availability while active; previously read data cannot be recalled instantaneously,
and a previously signed photo retains only its original short expiry.

## Review a case

Open the internal Moderation screen. Queues list open/resolved/dismissed cases, oldest
first with timestamp/UUID pagination, 20 at a time. Open a case to inspect its report
category, optional detail, username/word context, status and current removal/restriction.
Reporter identity is omitted from the interface and must never be disclosed to the
reported account. Block relationships are available only in each blocker's own list.

The preview authorizes only the verified completed photo associated with this case,
including a photo later made private or removed from Discover. It cannot inspect an
arbitrary unreported private photo, pending/deleting/deleted object or unverified
version. URLs last 60 seconds; reload the case for a fresh authorized preview.
Do not distribute case details or short-lived capabilities outside authorized review.

Available actions, each with confirmation and optional reason (≤500 characters):

- Remove/restore photo public eligibility. Removal does not erase the image, complete
  a deletion, reverse XP or change private vocabulary. Owner visibility changes do
  not clear removal. Restore still respects current visibility, blocks and restrictions.
- Restrict/restore account public participation. Existing sessions cannot use public
  feed/signing, publish or rate while restricted. Private learning/data remain intact.
  Restoring an account does not clear individually removed photos.
- Resolve/dismiss the report. Cases remain reviewable, with immutable audit history.
  A later new report may be filed after closure; duplicates while open keep the first
  report's details. There is no automated outcome disclosure to the reported user.

Accepted actions record moderator, action, target, server timestamp and optional
reason. The interface retains one request UUID during a pending/failed confirmation;
explicit retries do not reapply an old action or create duplicate audit events.
After uncertainty, reload the current case and audit history before choosing another
intent. Audit history is paginated; it is never editable through the app or REST.

## Operational acceptance and remaining work

Test ordinary-user denial, two real moderators, revocation, removal/restore,
restriction/restore, private-case previews, offline retries and multiple-device races
in the intended hosted development environment on iOS and Android. Repeat the
checklist in `PHASE9_VERIFICATION.md`. Use test accounts/content only.

Define staffing, review cadence, escalation/incident handling, and the organization’s
content and data-retention policies before public launch. Reports/details and audit
identifiers persist through hard account/content deletion; this implementation adds
no automatic retention deadline, appeals workflow or permanent deletion policy.
Optional details can contain sensitive information; restrict operational access and
handle any future erasure/retention process explicitly without silently rewriting
audit history. This document does not implement additional product features.

Measure workload, hot-account lock contention, query latency and report abuse under
realistic production volumes. Current protections are controlled targets/reasons,
500-character detail limits, one open report per reporter/target, bounded reads,
mutual blocks and backend roles. No reputation scoring or invented report quotas.
