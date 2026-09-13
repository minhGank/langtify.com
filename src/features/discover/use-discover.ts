import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  FeedSettingsChanged,
  type FeedCursor,
  type FeedGateway,
  type FeedItem,
} from '@/services/discover';

type Window = { items: FeedItem[]; cursor: FeedCursor | null; hasMore: boolean };
const empty = (): Window => ({ items: [], cursor: null, hasMore: false });
// Two pages remain in memory; signing and revalidation are always a single batch.
export function useDiscover(gateway: FeedGateway) {
  const [data, setData] = useState<Window>(empty),
    [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [settingsChanged, setSettingsChanged] = useState(false),
    [photoRevision, setPhotoRevision] = useState(0);
  const current = useRef<Window>(empty()),
    generation = useRef(0),
    visible = useRef(false);
  const activeGateway = useRef<FeedGateway | null>(null),
    abort = useRef<AbortController | null>(null),
    pending = useRef(false);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPhotos = useCallback(() => {
    if (expiry.current) clearTimeout(expiry.current);
    expiry.current = null;
    setPhotos({});
  }, []);
  const clear = useCallback(() => {
    current.current = empty();
    setData(empty());
    clearPhotos();
  }, [clearPhotos]);
  const read = useCallback(
    async (mode: 'initial' | 'more' | 'renew') => {
      if (
        !visible.current ||
        activeGateway.current !== gateway ||
        (mode !== 'initial' && pending.current)
      )
        return;
      const request = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pending.current = true;
      setLoading(true);
      setError(null);
      setSettingsChanged(false);
      let next = current.current;
      if (mode === 'initial') {
        clear();
        next = empty();
      }
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
        const remaining = 55000 - (performance.now() - started);
        if (remaining <= 0) throw new Error('Expired feed photos.');
        // Revalidation drops newly private/deleting/unavailable items and updates usernames.
        current.current = { ...next, items: approved.items };
        setData(current.current);
        clearPhotos();
        setPhotos(approved.photos);
        setPhotoRevision((n) => n + 1);
        if (approved.items.length)
          expiry.current = setTimeout(() => {
            setPhotos({});
            setError('Photos expired. Reload the feed to continue.');
          }, remaining);
      } catch (cause) {
        if (request === generation.current) {
          clear();
          setSettingsChanged(cause instanceof FeedSettingsChanged);
          setError(
            cause instanceof FeedSettingsChanged
              ? cause.message
              : 'Discover could not be loaded. Please retry.',
          );
        }
      } finally {
        if (request === generation.current) {
          pending.current = false;
          abort.current = null;
          setLoading(false);
        }
      }
    },
    [gateway, clear, clearPhotos],
  );
  const refresh = useCallback(() => read('initial'), [read]);
  const loadMore = useCallback(() => {
    if (current.current.hasMore) return read('more');
  }, [read]);
  const renew = useCallback(() => read('renew'), [read]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      activeGateway.current = gateway;
      visible.current = AppState.currentState === 'active';
      if (visible.current) void refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (!focused) return;
        visible.current = state === 'active';
        if (visible.current) void refresh();
        else {
          generation.current++;
          abort.current?.abort();
          abort.current = null;
          pending.current = false;
          clear();
        }
      });
      const timer = setInterval(() => {
        if (focused && visible.current && !pending.current) void renew();
      }, 45000);
      return () => {
        focused = false;
        visible.current = false;
        activeGateway.current = null;
        generation.current++;
        abort.current?.abort();
        abort.current = null;
        pending.current = false;
        clearInterval(timer);
        listener.remove();
        clear();
      };
    }, [gateway, refresh, renew, clear]),
  );
  return {
    items: data.items,
    hasMore: data.hasMore,
    photos,
    photoRevision,
    loading,
    error,
    settingsChanged,
    refresh,
    loadMore,
    renew,
  };
}
