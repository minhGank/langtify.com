import { createServerCache } from '@/lib/server-cache';
import type { InboxCursor, InboxOpenReceipt, InboxPage, InboxSummary } from '@/services/inbox';

export type InboxWindow = InboxPage & { olderWindow: boolean; cursor?: InboxCursor | null };
export const inboxCache = createServerCache<InboxWindow>({ maxEntries: 2 });
export const inboxSummaryCache = createServerCache<InboxSummary>({ maxEntries: 2 });
export const inboxOpeningCache = createServerCache<InboxOpenReceipt>({ maxEntries: 4 });
export function inboxEntries(scope: string) {
  return {
    list: inboxCache.entry(`${scope}:inbox:list`, ['inbox']),
    summary: inboxSummaryCache.entry(`${scope}:inbox:summary`, ['inbox', 'inbox-summary']),
  };
}
