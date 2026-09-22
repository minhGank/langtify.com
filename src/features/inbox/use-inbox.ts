import { useCallback, useMemo, useRef, useState } from 'react';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { discardPublicData } from '@/features/social/cache';
import type { InboxGateway, InboxNotification, InboxReceipt, InboxTarget } from '@/services/inbox';
import { inboxEntries } from './cache';

export const INBOX_WINDOW_SIZE = 60;
export function useInbox(identity: SafetyIdentity, gateway: InboxGateway) {
  const [hideTaskError, setHideTaskError] = useState(false);
  const entries = useMemo(
    () => inboxEntries(serverScope(identity.userId, identity.token)),
    [identity],
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await gateway.page(null, signal);
      if (!signal.aborted)
        entries.summary.set({ unreadCount: page.unreadCount, readCursor: page.readCursor });
      return { ...page, olderWindow: false };
    },
    [gateway, entries],
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
  const query = useServerQuery(entries.list, load, { staleTime: Infinity, discardOnError });
  const pendingWrite = useRef<object | null>(null);
  const reconcileWrite = () => {
    if (!entries.list.getSnapshot().retired) entries.list.invalidate();
    if (!entries.summary.getSnapshot().retired) entries.summary.invalidate();
  };
  const write = async (signal: AbortSignal, work: () => Promise<InboxReceipt>) => {
    if (signal.aborted) throw new Error('Request cancelled.');
    const request = {};
    pendingWrite.current = request;
    const interrupted = () => {
      if (pendingWrite.current === request) pendingWrite.current = null;
      reconcileWrite();
    };
    signal.addEventListener('abort', interrupted, { once: true });
    try {
      const receipt = await work();
      // The server may commit after focus loss or a timeout. A late receipt may
      // invalidate this origin's cache, but never install data or navigate.
      if (signal.aborted) reconcileWrite();
      return receipt;
    } catch (cause) {
      if (!signal.aborted) reconcileWrite();
      throw cause;
    } finally {
      signal.removeEventListener('abort', interrupted);
      if (pendingWrite.current === request) pendingWrite.current = null;
    }
  };
  const task = useSafetyTask(
    () => {
      if (pendingWrite.current) {
        pendingWrite.current = null;
        reconcileWrite();
      }
    },
    undefined,
    () => {
      discardPublicData(identity);
      entries.list.clear();
      entries.summary.clear();
    },
  );
  const acceptRead = (ids: ReadonlySet<string>, read: boolean, receipt: InboxReceipt) => {
    const saved = entries.list.getSnapshot().data;
    if (saved)
      entries.list.set(
        {
          ...saved,
          unreadCount: receipt.unreadCount,
          items: saved.items.map((item) => (ids.has(item.id) ? { ...item, read } : item)),
        },
        { preserveFreshness: true },
      );
    entries.summary.set(
      { unreadCount: receipt.unreadCount, readCursor: saved?.readCursor ?? null },
      { preserveFreshness: true },
    );
  };
  const read = (item: InboxNotification) => {
    if (query.loading || task.busy) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    void task.run(
      (signal) => write(signal, () => gateway.read(item.id, !item.read, signal)),
      (receipt) => {
        if (revision === entries.list.getRevision())
          acceptRead(new Set([item.id]), !item.read, receipt);
      },
    );
  };
  const readAll = () => {
    const saved = entries.list.getSnapshot().data;
    const cursor = saved?.readCursor;
    if (query.loading || task.busy || !cursor || !saved) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    const ids = new Set(saved.items.map((item) => item.id));
    void task.run(
      (signal) => write(signal, () => gateway.readAll(cursor, signal)),
      (receipt) => {
        if (revision === entries.list.getRevision()) acceptRead(ids, true, receipt);
      },
    );
  };
  const open = (item: InboxNotification, navigate: (target: InboxTarget) => void) => {
    if (query.loading || task.busy) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    void task.run(
      async (signal) => {
        const target = await gateway.resolve(item.id, signal);
        if (signal.aborted || revision !== entries.list.getRevision())
          throw new Error('Request cancelled.');
        // Resolve live eligibility first; cached display data never authorizes navigation.
        const receipt = await write(signal, () => gateway.read(item.id, true, signal));
        return { target, receipt };
      },
      ({ target, receipt }) => {
        if (revision !== entries.list.getRevision()) return;
        acceptRead(new Set([item.id]), true, receipt);
        navigate(target);
      },
    );
  };
  const more = () => {
    const saved = entries.list.getSnapshot().data;
    const last = saved?.items.at(-1);
    if (query.loading || task.busy || !saved?.hasMore || !last) return;
    setHideTaskError(false);
    const revision = entries.list.getRevision();
    void task.run(
      (signal) => gateway.page({ time: last.createdAt, id: last.id }, signal),
      (page) => {
        if (revision !== entries.list.getRevision()) return;
        const ids = new Set(saved.items.map((item) => item.id));
        const combined = [...saved.items, ...page.items.filter((item) => !ids.has(item.id))];
        const items = combined.slice(-INBOX_WINDOW_SIZE);
        entries.list.set({
          ...page,
          items,
          olderWindow: saved.olderWindow || combined.length > INBOX_WINDOW_SIZE,
        });
        entries.summary.set({ unreadCount: page.unreadCount, readCursor: page.readCursor });
      },
    );
  };
  return {
    ...query,
    busy: task.busy,
    taskError: hideTaskError ? null : task.error,
    read,
    readAll,
    open,
    more,
    refresh: async () => {
      if (task.busy) return false;
      setHideTaskError(true);
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
