# Langtify product decisions

Name: **Langtify**. Domain: `langtify.com`. Package and Expo slug: `langtify`.
Mobile-first Expo / React Native / strict TypeScript; iOS and Android are primary.

## Current scope: Phase 2

Supabase email/password authentication, persisted sessions, authoritative profiles,
and onboarding (username, reference language, target language, CEFR level, IANA
timezone). The four tabs remain Today, Discover, Vocabulary, and Profile. Only
Profile gains authenticated account and learning information and sign out.

English and French are the initial active language catalog. English is available
as a reference language and French as a target language. Reference and target
must differ. V1 allows one learning profile per user. More languages can be added
to the catalog without schema changes.

## Confirmed future product rules — not implemented in Phase 2

- Supabase/PostgreSQL is authoritative for product-critical state.
- A daily challenge contains three photographable vocabulary words.
- Vocabulary levels are CEFR A1, A2, B1, B2, C1, C2.
- Slots are review (one level below), target (current level), stretch (one above).
- A1 boundary: A1 / A1 / A2. C2 boundary: C1 / C2 / C2.
- Users may replace assigned words; replacements preserve the slot's CEFR level.
- Completing at least one daily word maintains the streak.
- Photo submissions can be public or private and default to private.
- Photos will be stored in Supabase Storage.
- Community semantic ratings use a 1–5 scale.

No vocabulary, assignments, replacement, camera, uploads, buckets, streaks, feed,
ratings, comments, social connections, notifications, or moderation are built in
Phase 2. Google, Apple, magic-link, and social login are also out of scope.

## Open questions

Vocabulary sources/licensing, photographability review, challenge day/reset
semantics, replacement limits, submission edits/retention/deletion, rating labels,
eligibility and aggregation, moderation, and release policies remain undecided.
Do not infer additional rules from future planning documents.
