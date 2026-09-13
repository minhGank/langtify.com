# Langtify product decisions

Name: **Langtify**. Domain: `langtify.com`. Package and Expo slug: `langtify`.
Mobile-first Expo / React Native / strict TypeScript; iOS and Android are primary.

## Current scope: Phase 4

Supabase email/password authentication, persisted sessions, authoritative profiles,
and onboarding (username, reference language, target language, CEFR level, IANA
timezone). The four tabs remain Today, Discover, Vocabulary, and Profile. Profile shows authenticated account and learning information and sign out. Today
shows real daily challenge cards, replacement and camera/photo completion; Discover and Vocabulary remain placeholders.

English and French are the initial active language catalog. English is available
as a reference language and French as a target language. Reference and target
must differ. V1 allows one learning profile per user. More languages can be added
to the catalog without schema changes.

## Vocabulary and daily challenges — implemented in Phase 3

- Supabase/PostgreSQL is authoritative for product-critical state.
- A daily challenge contains three photographable vocabulary words.
- Vocabulary levels are CEFR A1, A2, B1, B2, C1, C2.
- Slots are review (one level below), target (current level), stretch (one above).
- A1 boundary: A1 / A1 / A2. C2 boundary: C1 / C2 / C2.
- Users may replace assigned words; replacements preserve the slot's CEFR level.

Vocabulary uses shared semantic concepts, with one primary term per concept/language.
A meaning may have different CEFR levels in different languages. Ambiguous meanings
such as financial bank and river bank remain separate concepts. Translations follow
concept linkage; there is no manually duplicated translation table.

The server derives identity, learning configuration and local date from persisted
state and server time. Each learning profile has at most one challenge per local
calendar date, with three active slots. Eligible terms match the exact target
language and slot CEFR, are active, belong to an active photographable concept,
and have an active reference-language equivalent. Insufficient pools return an
error without substitutions at another level or partial challenge creation.

Selection excludes every concept already assigned in that challenge, including
replaced words. It prefers never-assigned concepts, then least recently assigned
concepts, randomizing ties. Repeat history is concept-based across the user's
challenges; no mastery score or spaced repetition is implemented.

Repeated replacements are allowed while eligible concepts remain. The server
chooses a different concept at the original slot level/language, preserving the
retired assignment. Old active IDs cannot be replaced twice. No replacement-count
limit was introduced. Challenges snapshot their configuration and displayed terms;
later settings/catalog changes never rewrite them. Same-profile/same-date calls
reuse the existing snapshot. A timezone change can change which local date is
requested, without editing prior challenges.

## Camera capture and submissions — implemented in Phase 4

A user opens a Today card, takes a camera photo, reviews the normalized preview,
chooses private/public (default private), and explicitly submits. There is no gallery
upload. One successful submission completes the assignment and blocks replacement.
A pending upload must be finished or discarded before replacing its word. Owner-only
photo detail shows the saved vocabulary, translation, challenge date, submission
time and visibility. Owners may change visibility without moving files.

Deletion removes the image and retires the submission before freeing the word for
a new photo or replacement. Interrupted uploads/deletions are recoverable; a scheduled
maintenance job cleans abandoned uploads. Public means eligible for a later feed,
not publicly readable storage. All photo access remains owner-only in this phase.

Unfinished photos on Today also lists owner-only pending/deleting operations from
earlier dates, so restart or midnight does not strand an uploaded photo. This
recovery read is independent of current challenge generation; it is not a gallery
or feed.

## Future rules — not implemented in Phase 4

- Completing at least one daily word maintains the streak.
- Community semantic ratings use a 1–5 scale.

Streaks, feed, ratings, comments,
followers, notifications and moderation are out of scope. Google, Apple,
magic-link, and social login remain out of scope. Phase 5 has not started.

## Open questions

Production vocabulary sources/licensing and CEFR/photographability review,
submission retention and further edits, rating labels, eligibility and aggregation,
moderation, and release policies remain undecided. The modest vocabulary seed is
for development only, not a validated production learning catalog.
