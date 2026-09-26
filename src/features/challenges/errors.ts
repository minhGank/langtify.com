export function challengeError(error: unknown, replacing = false): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : '';
  if (message === 'insufficient_vocabulary')
    return replacing
      ? 'No other words are available at this level today. Your word hasn’t changed.'
      : 'We don’t have enough words for these languages and level yet. Try again later.';
  if (message === 'assignment_unavailable')
    return 'This word has changed or is no longer available. Refresh Today.';
  if (message === 'assignment_has_submission')
    return 'Open this word’s photo to view it or finish uploading.';
  if (message === 'onboarding_required')
    return 'We couldn’t load your learning settings. Sign in again.';
  return replacing
    ? 'We couldn’t confirm the replacement. Refresh Today before trying again.'
    : 'We couldn’t load today’s words. Check your connection and try again.';
}
