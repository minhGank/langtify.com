import type { InboxTarget } from '@/services/inbox';

// Database IDs select one of these fixed destinations. No payload-supplied path,
// URL, owner identity, signed media capability, or navigation options are accepted.
export function inboxDestination(target: InboxTarget) {
  switch (target.kind) {
    case 'NEW_FOLLOWER':
      return { pathname: '/public-profile' as const, params: { profileId: target.profileId } };
    case 'NEW_RATING':
      return { pathname: '/post' as const, params: { submissionId: target.submissionId } };
    case 'DAILY_WORDS_READY':
      return '/' as const;
  }
}
