# Langtify voice and interface copy

Langtify is curious, encouraging and concise. Speak to the learner, describe the
next useful action, and let photos and words carry the personality. Keep ordinary
screens calm. Avoid corporate language, baby talk, repeated instructions, unnecessary
exclamation marks and decorative emoji.

## Terminology

| Use                                   | Meaning / avoid                                                     |
| ------------------------------------- | ------------------------------------------------------------------- |
| Create account                        | Signup action; avoid Sign up / Register in buttons                  |
| Sign in / Sign out                    | Authentication actions; avoid Log in / Log out                      |
| Continue with Google                  | The existing Google entry, not a separate Langtify account          |
| Verify your email / verification link | Email verification; never claim an email was delivered              |
| Photo / Add photo                     | Avoid image, submission, upload record and capture as a noun        |
| Profile photo                         | Avoid avatar in visible and accessibility copy                      |
| Today / Today's Challenge             | Today's assigned words and their daily completion                   |
| Past Words                            | Earlier final assignments; no invented daily/streak reward          |
| Vocabulary / My Vocabulary            | The learner's photo collection; repeated photos stay photos         |
| Translation language                  | The existing reference-language setting                             |
| Learning language                     | The existing target-language setting                                |
| Profile                               | Public username/photo and the existing profile screen               |
| Account                               | Sign-in identity and security, not the public profile               |
| Notifications                         | In-app inbox                                                        |
| Reminders                             | Existing remote daily-word/streak alerts; never guaranteed delivery |
| Public / Private                      | Sharing state, not Storage bucket access                            |
| Photo match                           | Semantic rating; preserve the five existing score meanings          |

Keep proper navigation names stable. Buttons use sentence case and a verb: Add photo,
Save username, Remove photo. Use a specific action when a screen has more than one
retry target, such as Reload words beside a progress retry. Accessibility labels
must identify the same action and its object, without exposing backend enum names.

## Write less

Remove copy that repeats the heading, selected control or visible result. This pass
removes the auth taglines, repeated newest-first captions in Discover/profile/comments,
rating tap tutorials, and descriptions of what follower/following lists contain.
Retain guidance when it explains privacy, a reward consequence, a recovery action,
permission value or an unfamiliar choice. Loading placeholders do not need paragraphs.

## Errors and trust

Explain the problem and recovery: “We couldn’t load this photo. Try again.”
Distinguish an unavailable/deleted item from a temporary loading failure. When a
write may have succeeded, say it could not be confirmed and ask the user to check
or refresh before retrying; do not claim it failed or automatically replay it.

Never display arbitrary Error.message, provider responses, SQL/RPC names, paths,
tokens or stack traces. Use known codes or controlled application error types.
Username editing now maps its conflict explicitly and hides unexpected Auth-refresh
errors. Diagnostic strings may remain internal as long as they cannot reach UI.
The route error fallback offers safe retry guidance without rendering the thrown
error, stack or route parameters.
Moderator action/reason/status enums get readable labels; moderator identifiers
remain in the privileged audit view for traceability.

Signup completion is conditional and identical for real and obfuscated responses.
No identity/email lookup is added. A successful resend request is not proof of an
email or of delivery. Password length feedback is not a strength guarantee.

## Privacy, permissions and consequences

“Private · not shared” describes the public-sharing choice without falsely promising
that authorized report review is impossible. Sharing also appears on public profiles;
it is not described as Discover-only. A profile photo is shown on the public profile.

Before deleting a completed daily photo, explain possible XP, bonus and streak effects.
Deleting a historical photo removes its word XP without daily/streak effects. Keep
existing confirmation/admission behavior; copy never authorizes a destructive action.
Reports are visible to moderators, not the reported person. Block/unblock explains
mutual public interaction consequences without revealing private relationship data.

Camera and photo-library purpose strings describe capturing words and choosing photos.
Keep the existing native prompts, permission timing and limited-library behavior.
Remote reminders and the in-app inbox remain separate, including Personal Team builds.

Vocabulary terms, translations, snapshots, usernames and user-authored comments are
not rewritten. Interface wording must never modify stored content or product rules.

Physical iPhone review is required before this voice/copy pass is final. See
[AUTH_COPY_AUDIT.md](AUTH_COPY_AUDIT.md) for verification and acceptance.
