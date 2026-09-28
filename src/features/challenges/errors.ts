export function challengeError(error: unknown, replacing = false): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : '';
  if (message === 'insufficient_vocabulary')
    return replacing
      ? 'No other new words are available at this level. Your word hasn’t changed.'
      : 'Not enough new words are available for this challenge yet. You can still browse your vocabulary.';
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
