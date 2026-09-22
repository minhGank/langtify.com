import { router } from 'expo-router';
import { serverScope } from '@/lib/server-cache';
import type { FeedIdentity, FeedItem } from '@/services/discover';
import { seedPostWindow } from './use-discover';

export function postCacheKey(identity: FeedIdentity, id: string) {
  return `${serverScope(identity.userId, identity.token)}:post:${identity.targetLanguageId}:${id}`;
}
export function openPost(identity: FeedIdentity, item: FeedItem) {
  seedPostWindow(
    postCacheKey(identity, item.id),
    item,
    serverScope(identity.userId, identity.token),
  );
  router.push({ pathname: '/post', params: { submissionId: item.id } });
}
