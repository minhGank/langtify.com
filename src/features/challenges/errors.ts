export function challengeError(error: unknown, replacing = false): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : '';
  if (message === 'insufficient_vocabulary')
    return replacing
      ? 'No more eligible words are available for this slot today. Your current word is unchanged.'
      : 'There are not enough eligible words for your language pair and level yet. Please try again later.';
  if (message === 'assignment_unavailable')
    return 'This word has already changed or is unavailable. Refresh today’s challenge.';
  if (message === 'assignment_has_submission')
    return 'This word has a photo or an upload in progress. Open its photo to finish or delete it.';
  if (message === 'onboarding_required')
    return 'Your learning profile is unavailable. Please sign in again.';
  return replacing
    ? 'We could not replace this word. Refresh to check its saved state, then try again.'
    : 'We could not load your challenge. Check your connection and try again.';
}
