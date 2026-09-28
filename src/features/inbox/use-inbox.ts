import { useCallback, useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { discardPublicData } from '@/features/social/cache';
import type { InboxGateway, InboxNotification, InboxTarget } from '@/services/inbox';
import { inboxEntries, inboxOpeningCache } from './cache';

export const INBOX_WINDOW_SIZE = 60;
export function useInbox(identity: SafetyIdentity, gateway: InboxGateway) {
  const [hideTaskError, setHideTaskError] = useState(false);
  // One route lifetime, not each focus, token refresh, pagination or foreground.
  // The server retains this receipt so retrying an uncertain open cannot widen it.
  const [requestId] = useState(() => randomUUID());
  const scope = serverScope(identity.userId, identity.token);
  const entries = useMemo(() => inboxEntries(scope), [scope]);
  const openEntry = useMemo(
    () => inboxOpeningCache.entry(`${scope}:inbox-open:${requestId}`, ['inbox-open']),
    [scope, requestId],
  );
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable)) return false;
      discardPublicData(identity, entries.list);
      entries.summary.clear();
      return true;
    },
    [identity, entries],
  );
  const admit = useCallback(
    async (signal: AbortSignal) => {
      entries.list.cancel();
      entries.summary.cancel();
      const revision = entries.list.getRevision();
      const summaryRevision = entries.summary.getRevision();
      const saved = entries.list.getSnapshot().data;
      const ids = saved?.items.map((item) => item.id) ?? [];
      try {
        const receipt = await gateway.openInbox(requestId, ids, signal);
        if (!signal.aborted && !openEntry.getSnapshot().retired) {
          if (saved && revision === entries.list.getRevision()) {
            const read = new Map(receipt.readStates.map((row) => [row.id, row.read]));
            entries.list.set(
              {
                ...saved,
                unreadCount: receipt.unreadCount,
                readCursor: receipt.readCursor,
                items: saved.items
                  .filter((item) => read.has(item.id))
                  .map((item) => ({ ...item, read: read.get(item.id) === true })),
              },
              { preserveFreshness: true },
            );
          }
          if (summaryRevision === entries.summary.getRevision())
            entries.summary.set({
              unreadCount: receipt.unreadCount,
              readCursor: receipt.readCursor,
            });
        }
        return receipt;
      } finally {
        // An uncertain write may still commit. Never install its late data; ensure
        // the origin's next read reconciles, without refreshing unrelated screens.
        if (signal.aborted && !openEntry.getSnapshot().retired) {
          entries.list.invalidate();
          entries.summary.invalidate();
        }
      }
    },
    [entries, gateway, requestId, openEntry],
  );
  const opening = useServerQuery(openEntry, admit, { staleTime: Infinity, discardOnError });
  const load = useCallback(
    async (signal: AbortSignal) => {
      const revision = entries.summary.getRevision();
      const page = await gateway.page(null, signal);
      if (!signal.aborted && revision === entries.summary.getRevision())
        entries.summary.set({ unreadCount: page.unreadCount, readCursor: page.readCursor });
      const last = page.items.at(-1);
      return {
        ...page,
        olderWindow: false,
        cursor: last ? { time: last.createdAt, id: last.id } : null,
      };
    },
    [gateway, entries],
  );
  const query = useServerQuery(entries.list, load, {
    staleTime: Infinity,
    discardOnError,
    enabled: !!opening.data,
  });
  const task = useSafetyTask(
    () => {},
    undefined,
    () => {
      discardPublicData(identity);
      entries.list.clear();
      entries.summary.clear();
    },
  );
  const open = (item: InboxNotification, navigate: (target: InboxTarget) => void) => {
    if (query.loading || task.busy || !opening.data) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    void task.run(
      (signal) => gateway.resolve(item.id, signal),
      (target) => {
        if (revision === entries.list.getRevision()) navigate(target);
      },
    );
  };
  const more = () => {
    const saved = entries.list.getSnapshot().data;
    const last = saved?.items.at(-1);
    const cursor = saved?.cursor ?? (last ? { time: last.createdAt, id: last.id } : null);
    if (query.loading || task.busy || !opening.data || !saved?.hasMore || !cursor) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    const summaryRevision = entries.summary.getRevision();
    void task.run(
      (signal) => gateway.page(cursor, signal),
      (page) => {
        if (revision !== entries.list.getRevision()) return;
        const ids = new Set(saved.items.map((item) => item.id));
        const combined = [...saved.items, ...page.items.filter((item) => !ids.has(item.id))];
        const tail = page.items.at(-1);
        entries.list.set({
          ...page,
          items: combined.slice(-INBOX_WINDOW_SIZE),
          cursor: tail ? { time: tail.createdAt, id: tail.id } : cursor,
          olderWindow: saved.olderWindow || combined.length > INBOX_WINDOW_SIZE,
        });
        if (summaryRevision === entries.summary.getRevision())
          entries.summary.set({ unreadCount: page.unreadCount, readCursor: page.readCursor });
      },
    );
  };
  return {
    ...query,
    loading: query.loading || opening.loading,
    error: query.error || opening.error,
    busy: task.busy || opening.loading,
    taskError: hideTaskError ? null : task.error,
    open,
    more,
    refresh: async () => {
      if (task.busy) return false;
      setHideTaskError(true);
      if (!openEntry.getSnapshot().data) {
        await opening.refresh();
        return false;
      }
      const revision = entries.list.getRevision();
      await query.refresh();
      const saved = entries.list.getSnapshot();
      return (
        entries.list.getRevision() !== revision &&
        !saved.retired &&
        !saved.error &&
        !saved.loading &&
        saved.data !== null &&
        !saved.data.olderWindow &&
        Number.isFinite(saved.updatedAt)
      );
    },
  };
}
