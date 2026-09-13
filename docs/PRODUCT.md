# Langtify product decisions

Name: **Langtify**. Domain: `langtify.com`. Package and Expo slug: `langtify`.
Mobile-first Expo / React Native / strict TypeScript; iOS and Android are primary.

## Current scope: Phase 5

Supabase email/password authentication, persisted sessions, authoritative profiles,
and onboarding (username, reference language, target language, CEFR level, IANA
timezone). The four tabs remain Today, Discover, Vocabulary, and Profile. Profile shows authenticated account, learning information, progress and sign out. Today
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

## Daily progress, streaks, XP and levels — Phase 5

Each valid completed assignment earns 10 XP. A daily challenge with all three
assignments complete earns an additional 10 XP: 1/3 = 10, 2/3 = 20, 3/3 = 40.
The full bonus belongs to that challenge, even if an interrupted photo finishes
on a later date. Pending uploads earn nothing. Visibility does not affect XP.

At least one valid word completion qualifies its completion's local calendar day.
The database uses server time and the learning profile's persisted IANA timezone
at finalization; the original challenge date and device clock do not select the
streak day. Multiple words on one date count once. Timezone changes never rewrite
saved completion dates. Consecutive distinct dates form a streak, including DST
days shorter or longer than 24 hours. Current streak counts through today, or
through yesterday if today has no completion; a fully missed day resets it to zero.
Longest streak is the longest surviving consecutive run.

Milestone XP per streak occurrence: 3 days = 10, 7 = 25, 14 = 40, 30 = 75,
60 = 125, 100 = 200. No daily multiplier. Candidates are created when a date first
qualifies and the run ending on that date first reaches the exact threshold.
Each candidate retains its original qualifying date window. A later new streak
can earn the thresholds again. Deletion never creates retrospective rewards for
split runs; restoring a previously qualified date cannot create new candidates.
Only one eligible reward of each threshold is credited per continuous run,
including if timezone changes subsequently join two runs.

Deleting a photo reverses its word XP, any lost full-challenge bonus and any
milestone whose original qualifying window breaks. Removing one of several words
on the same completion date retains that date's streak. Credit remains until
physical deletion and submission retirement finish; pending deletion is recoverable.
A resubmission earns credit for its actual new completion day and restores the
assignment's existing XP source, with signed reversals retained in history.
Repeated submit/delete/resubmit cannot increase net/lifetime XP beyond currently
valid sources. Historical deletion may reduce total XP, level, current/longest
streak, completed-word count and fully completed-challenge count.

Level starts at 0. Advancing from level L costs `100 + 50 × L` XP; the cumulative
threshold to enter L is `25 × L × (L + 3)`. Thresholds are 0, 100, 250, 450, 700,
1000, 1350… Therefore 620 XP is Level 3, with 170/250 XP toward Level 4 (700 total).
The exact formula takes precedence over illustrative examples. Total XP and level
come from the server's signed ledger; the client never awards either.

Today displays n/3, full-completion bonus, level, XP and current streak. Photo detail
shows server-confirmed XP feedback. Profile adds progress toward the next level,
longest streak and lifetime counts of currently valid words/full challenges.

## Future scope — not implemented

Community feed, semantic ratings (1–5), comments, followers, notifications,
leaderboards, achievements and subscriptions are not included. Phase 6 has not
started. Google, Apple, magic-link and social login remain out of scope.

## Open questions

Production vocabulary sources/licensing and CEFR/photographability review,
submission retention and further edits, rating labels, eligibility and aggregation,
moderation, and release policies remain undecided. The modest vocabulary seed is
for development only, not a validated production learning catalog.
