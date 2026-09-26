import { Share } from 'react-native';
import type { FeedItem } from '@/services/discover';

// No bearer URL, owner identity, or unsupported public-post route leaves the app.
// Recipients get useful vocabulary context without needing an authenticated link.
export async function sharePost(item: Pick<FeedItem, 'targetTerm' | 'referenceTerm' | 'username'>) {
  return Share.share({
    title: `${item.targetTerm} · Langtify`,
    message: `${item.targetTerm} — ${item.referenceTerm}\nA word in photos by @${item.username} on Langtify.\nhttps://langtify.com`,
  });
}
