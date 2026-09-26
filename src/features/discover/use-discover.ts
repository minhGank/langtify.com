import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createServerCache, isolatedCacheKey, discardServerData } from '@/lib/server-cache';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { feedback } from '@/lib/haptics';
import { RatingUnavailable, type RatingAction, type RatingScore } from '@/features/ratings/rating';
import {
  FeedSettingsChanged,
  type FeedCursor,
  type FeedGateway,
  type FeedItem,
} from '@/services/discover';

type ReadMode = 'initial' | 'more' | 'renew';
type Window = { items: FeedItem[]; cursor: FeedCursor | null; hasMore: boolean };
const empty = (): Window => ({ items: [], cursor: null, hasMore: false });
const cache = createServerCache<Window>({ maxEntries: 4 });
export function invalidateDiscoverWindow(key: string) {
  cache.entry(key, ['discover']).invalidate();
}
export function seedPostWindow(key: string, item: FeedItem, scope: string) {
  // Only an already authorized in-memory projection seeds navigation. No photo
  // capability or copied metadata goes into Router state. Receipts still patch
  // all related windows; an invalidated source cannot authorize later writes.
  const sources: string[] = [];
  cache.update((source, window) => {
    if (source !== key && source.startsWith(`${scope}:`) && window.items.includes(item))
      sources.push(source);
    return window;
  });
  const fresh = sources.some((source) => {
    const saved = cache.entry(source, ['discover']).getSnapshot();
    return !saved.retired && saved.data?.items.includes(item) && Number.isFinite(saved.updatedAt);
  });
  const target = cache.entry(key, ['discover']);
  if (fresh) target.set({ items: [item], cursor: null, hasMore: false });
  else target.invalidate({ discard: true });
}
// Two pages remain in memory; signing and revalidation are always a single batch.
export function useDiscover(gateway: FeedGateway, cacheKey?: string, scope?: string) {
  const entry = useMemo(
    () => cache.entry(cacheKey ?? isolatedCacheKey(gateway), ['discover']),
    [cacheKey, gateway],
  );
  useEffect(() => entry.retain(), [entry]);
  const [ratingAction, setRatingAction] = useState<RatingAction | null>(null);
  const writing = useRef(false),
    queuedRead = useRef<ReadMode | null>(null);
  const activeRead = useRef<ReadMode | null>(null);
  const activeRating = useRef<string | null>(null);
  const [data, setData] = useState<Window>(() => entry.getSnapshot().data ?? empty()),
    [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [displayActive, setDisplayActive] = useState(false);
  const [settingsChanged, setSettingsChanged] = useState(false),
    [photoRevision, setPhotoRevision] = useState(0);
  const current = useRef<Window>(entry.getSnapshot().data ?? empty()),
    generation = useRef(0),
    visible = useRef(false);
  const activeGateway = useRef<FeedGateway | null>(null),
    abort = useRef<AbortController | null>(null),
    pending = useRef(false);
  const renderedPhotos = useRef<Record<string, string>>({});
  const ownedEntry = useRef(entry);
  const clearPhotos = useCallback(() => {
    renderedPhotos.current = {};
    setPhotos({});
  }, []);
  const clear = useCallback(() => {
    setRatingAction(null);
    current.current = empty();
    setData(empty());
    clearPhotos();
  }, [clearPhotos]);
  const read = useCallback(
    async function readFeed(mode: ReadMode): Promise<void> {
      if (
        !visible.current ||
        entry.getSnapshot().retired ||
        activeGateway.current !== gateway ||
        (mode !== 'initial' && pending.current)
      )
        return;
      if (writing.current) {
        queuedRead.current = mode === 'initial' ? mode : (queuedRead.current ?? mode);
        return;
      }
      const request = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pending.current = true;
      activeRead.current = mode;
      setLoading(mode !== 'renew');
      setError(null);
      setSettingsChanged(false);
      let next = current.current;
      if (mode === 'initial') next = empty();
      try {
        // An emptied window still has a paging position. Only a truly initial
        // empty feed may poll the first page; explicit refresh resets any cursor.
        if (mode !== 'renew' || (!next.items.length && !next.cursor)) {
          const page = await gateway.load(mode === 'more' ? next.cursor : null, controller.signal);
          if (request !== generation.current) return;
          const last = page.items.at(-1);
          const combined = mode === 'more' ? [...next.items, ...page.items] : page.items;
          next = {
            items: Array.from(new Map(combined.map((item) => [item.id, item])).values()).slice(-24),
            cursor: last ? { time: last.submittedAt, id: last.id } : next.cursor,
            hasMore: page.hasMore,
          };
        }
        const started = performance.now();
        const approved = await gateway.previews(
          next.items.map((item) => item.id),
          controller.signal,
        );
        if (request !== generation.current) return;
        if (
          performance.now() - started >= 55000 &&
          Object.values(approved.photos).some((uri) => !uri.startsWith('data:image/jpeg;base64,'))
        )
          throw new Error('Expired feed photo access.');
        // Revalidation drops newly private/deleting/unavailable items and updates usernames.
        current.current = { ...next, items: approved.items };
        setData(current.current);
        entry.set(current.current);
        if (scope) {
          const authorized = new Set(approved.items.map((item) => item.id));
          const unavailable = new Set(
            next.items.filter((item) => !authorized.has(item.id)).map((item) => item.id),
          );
          if (unavailable.size)
            cache.update((key, value) => {
              if (value === current.current || !key.startsWith(`${scope}:`)) return value;
              const items = value.items.filter((item) => !unavailable.has(item.id));
              return items.length === value.items.length ? value : { ...value, items };
            });
        }
        setRatingAction((previous) =>
          previous?.status === 'error' &&
          approved.items.some(
            (item) => item.id === previous.id && item.viewerRating === previous.score,
          )
            ? null
            : previous,
        );
        clearPhotos();
        renderedPhotos.current = approved.photos;
        setPhotos(approved.photos);
        if (mode !== 'more') setPhotoRevision((n) => n + 1);
      } catch (cause) {
        if (request === generation.current) {
          if (cause instanceof FeedSettingsChanged || cause instanceof RatingUnavailable) {
            if (scope)
              discardServerData(
                [
                  'discover',
                  'public-profile',
                  'user-search',
                  'follows',
                  'comments',
                  'avatars',
                  'connections',
                  'inbox',
                ],
                { scope, except: entry },
              );
            clear();
            entry.clear();
          } else clearPhotos();
          setSettingsChanged(cause instanceof FeedSettingsChanged);
          setError(
            cause instanceof FeedSettingsChanged
              ? cause.message
              : 'We couldn’t load Discover. Try again.',
          );
        }
      } finally {
        if (request === generation.current) {
          pending.current = false;
          activeRead.current = null;
          abort.current = null;
          setLoading(false);
        }
      }
    },
    [gateway, entry, clear, clearPhotos, scope],
  );
  const rate = useCallback(
    async (id: string, score: RatingScore) => {
      if (
        !visible.current ||
        entry.getSnapshot().retired ||
        activeGateway.current !== gateway ||
        writing.current ||
        !current.current.items.some((item) => item.id === id && item.canRate)
      )
        return;
      const previousScore = current.current.items.find((item) => item.id === id)?.viewerRating;
      const request = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pending.current = false;
      activeRead.current = null;
      writing.current = true;
      activeRating.current = id;
      setLoading(false);
      setRatingAction({ id, score, status: 'saving' });
      // Cancellation must settle even if a transport ignores AbortSignal. A
      // timeout is an uncertain result, so reconcile instead of replaying intent.
      let rejectCancelled: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        rejectCancelled = () => reject(new Error('Rating request cancelled.'));
      });
      controller.signal.addEventListener('abort', rejectCancelled, { once: true });
      const deadline = setTimeout(() => controller.abort(), 20000);
      try {
        const summary = await Promise.race([gateway.rate(id, score, controller.signal), cancelled]);
        if (request !== generation.current) return;
        current.current = {
          ...current.current,
          items: current.current.items.map((item) =>
            item.id === id ? { ...item, ...summary } : item,
          ),
        };
        setData(current.current);
        entry.set(current.current);
        if (scope)
          cache.update((key, value) => {
            if (
              value === current.current ||
              !key.startsWith(`${scope}:`) ||
              !value.items.some((item) => item.id === id)
            )
              return value;
            return {
              ...value,
              items: value.items.map((item) => (item.id === id ? { ...item, ...summary } : item)),
            };
          });
        setRatingAction(null);
        if (summary.viewerRating === score && previousScore !== score) feedback.selection();
      } catch (cause) {
        if (request !== generation.current) return;
        if (cause instanceof RatingUnavailable || cause instanceof FeedSettingsChanged) {
          if (scope)
            discardServerData(
              [
                'discover',
                'public-profile',
                'user-search',
                'follows',
                'comments',
                'avatars',
                'connections',
                'inbox',
              ],
              { scope, except: entry },
            );
          clear();
          entry.clear();
          setError('This photo or your language settings have changed. Refresh Discover.');
          setSettingsChanged(cause instanceof FeedSettingsChanged);
          queuedRead.current = null;
        } else {
          setRatingAction({ id, score, status: 'error' });
          // An uncertain response can follow a committed vote. Re-read; never
          // automatically replay an old intent over a newer device's vote.
          queuedRead.current ??= 'renew';
        }
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', rejectCancelled);
        if (request === generation.current) {
          writing.current = false;
          activeRating.current = null;
          abort.current = null;
          const next = queuedRead.current;
          queuedRead.current = null;
          if (next) void read(next);
        }
      }
    },
    [gateway, entry, clear, read, scope],
  );
  const refresh = useCallback(() => read('initial'), [read]);
  const loadMore = useCallback(() => {
    if (current.current.hasMore) return read('more');
  }, [read]);
  const renew = useCallback(() => read('renew'), [read]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      const stop = () => {
        const uncertainRating = writing.current ? activeRating.current : null;
        setDisplayActive(false);
        visible.current = false;
        activeGateway.current = null;
        generation.current++;
        abort.current?.abort();
        abort.current = null;
        pending.current = false;
        activeRead.current = null;
        writing.current = false;
        activeRating.current = null;
        queuedRead.current = null;
        setRatingAction(null);
        setLoading(false);
        if (uncertainRating) {
          // Cancellation is not proof that the server rejected the vote. Keep
          // the intent consumed and require an authoritative read next time.
          // Collect first: entry lookup updates LRU order and must not mutate
          // the cache's Map while update() is traversing it.
          const affected: string[] = [];
          if (scope)
            cache.update((key, value) => {
              if (
                key.startsWith(`${scope}:`) &&
                value.items.some((item) => item.id === uncertainRating)
              )
                affected.push(key);
              return value;
            });
          entry.invalidate();
          for (const key of affected) {
            const sibling = cache.entry(key, ['discover']);
            if (sibling !== entry) sibling.invalidate();
          }
        }
      };
      const resume = () => {
        setDisplayActive(true);
        activeGateway.current = gateway;
        visible.current = true;
        const saved = entry.getSnapshot();
        if (ownedEntry.current !== entry) {
          ownedEntry.current = entry;
          clearPhotos();
        }
        current.current = saved.data ?? empty();
        setData(current.current);
        if (!saved.data || !Number.isFinite(saved.updatedAt)) void refresh();
        else {
          const ids = current.current.items.map((item) => item.id);
          const cached = gateway.cachedPreviews?.(ids) ?? renderedPhotos.current;
          if (ids.some((id) => !cached[id])) void renew();
          else {
            renderedPhotos.current = cached;
            setPhotos(cached);
            setLoading(false);
          }
        }
      };
      let invalidation = entry.getSnapshot().invalidation;
      const unsubscribe = entry.subscribe(() => {
        const snapshot = entry.getSnapshot();
        const shouldRefresh = snapshot.invalidation !== invalidation;
        if (!shouldRefresh && snapshot.data) {
          if (snapshot.data !== current.current && !writing.current) {
            // A rating in another visible/cached feed window shares the receipt.
            const interruptedRead = pending.current ? activeRead.current : null;
            generation.current++;
            abort.current?.abort();
            abort.current = null;
            pending.current = false;
            activeRead.current = null;
            setLoading(false);
            current.current = snapshot.data;
            setData(snapshot.data);
            const visibleIds = new Set(snapshot.data.items.map((item) => item.id));
            if (Object.keys(renderedPhotos.current).some((id) => !visibleIds.has(id))) {
              renderedPhotos.current = Object.fromEntries(
                Object.entries(renderedPhotos.current).filter(([id]) => visibleIds.has(id)),
              );
              setPhotos(renderedPhotos.current);
            }
            // Do not drop a user's refresh/page request when another window
            // receives a vote receipt. Restart after that acknowledged write.
            if (interruptedRead && focused && visible.current) void read(interruptedRead);
          }
          return;
        }
        invalidation = snapshot.invalidation;
        generation.current++;
        abort.current?.abort();
        pending.current = false;
        activeRead.current = null;
        writing.current = false;
        activeRating.current = null;
        queuedRead.current = null;
        setRatingAction(null);
        setLoading(false);
        if (!snapshot.data) clear();
        if (shouldRefresh && focused && visible.current) void refresh();
      });
      if (AppState.currentState === 'active') resume();
      const listener = AppState.addEventListener('change', (state) => {
        if (!focused) return;
        if (state === 'active') resume();
        else stop();
      });
      return () => {
        focused = false;
        stop();
        unsubscribe();
        listener.remove();
      };
    }, [gateway, entry, refresh, renew, read, clear, clearPhotos, scope]),
  );
  return {
    rate,
    ratingAction,
    items: data.items,
    hasMore: data.hasMore,
    photos: displayActive ? photos : {},
    photoRevision,
    loading,
    error,
    settingsChanged,
    refresh,
    loadMore,
    renew,
  };
}
