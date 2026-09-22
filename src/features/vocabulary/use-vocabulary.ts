import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createServerCache, isolatedCacheKey } from '@/lib/server-cache';
import type { HistoryCursor, VocabularyGateway, VocabularyPage } from '@/services/vocabulary';

type CachedPage = { page: VocabularyPage; cursor: HistoryCursor | null };
const cache = createServerCache<CachedPage>({ maxEntries: 12 });

// Metadata and cursor survive navigation; signed capabilities have their own
// shorter, monotonic lifetime and are never persisted with the cached page.
export function useVocabulary(gateway: VocabularyGateway, cacheKey?: string) {
  const entry = useMemo(
    () => cache.entry(cacheKey ?? isolatedCacheKey(gateway), ['vocabulary']),
    [cacheKey, gateway],
  );
  useEffect(() => entry.retain(), [entry]);
  const [data, setData] = useState<VocabularyPage | null>(
    () => entry.getSnapshot().data?.page ?? null,
  );
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [displayActive, setDisplayActive] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  const visible = useRef(false);
  const activeGateway = useRef<VocabularyGateway | null>(null);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0),
    cursor = useRef<HistoryCursor | null>(null);
  const current = useRef<VocabularyPage | null>(null);
  const pending = useRef(false);
  const renderedPhotos = useRef<Record<string, string | null>>({});
  const ownedEntry = useRef(entry);
  const clearPhotos = useCallback(() => {
    renderedPhotos.current = {};
    setPhotos({});
  }, []);
  const read = useCallback(
    async function readPage(
      next: HistoryCursor | null,
      reset: boolean,
      photosOnly = false,
      force = false,
    ): Promise<void> {
      if (
        !visible.current ||
        entry.getSnapshot().retired ||
        activeGateway.current !== gateway ||
        (pending.current && !force)
      )
        return;
      const request = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pending.current = true;
      cursor.current = next;
      setHasPrevious(next !== null);
      setLoading(!photosOnly);
      setError(false);
      if (reset && next !== null) clearPhotos();
      try {
        let page = photosOnly ? current.current : null;
        if (!page) {
          page = await gateway.load(next, controller.signal);
          if (request !== generation.current) return;
          current.current = page;
          setData(page);
          entry.set({ page, cursor: next });
        }
        if (!photosOnly) setPhotoError(false);
        const started = performance.now();
        try {
          const signed = await gateway.previews(
            page.items.map((item) => item.id),
            controller.signal,
          );
          if (request !== generation.current) return;
          if (
            performance.now() - started >= 55000 &&
            Object.values(signed).some((uri) => uri && !uri.startsWith('data:image/jpeg;base64,'))
          )
            throw new Error('Expired vocabulary photo access.');
          {
            clearPhotos();
            renderedPhotos.current = signed;
            setPhotos(signed);
            setPhotoRevision((revision) => revision + 1);
            setPhotoError(Object.values(signed).some((uri) => uri === null));
            // A null capability may mean deletion on another device. Reconcile
            // grouping/counts once; never leave a ghost concept indefinitely.
            if (photosOnly && Object.values(signed).some((uri) => uri === null)) {
              const fresh = await gateway.load(next, controller.signal);
              if (request !== generation.current) return;
              current.current = fresh;
              setData(fresh);
              entry.set({ page: fresh, cursor: next });
            }
          }
        } catch {
          if (request === generation.current) {
            clearPhotos();
            setPhotoError(true);
          }
        }
      } catch {
        if (request === generation.current) {
          clearPhotos();
          setError(true);
        }
      } finally {
        if (request === generation.current) {
          abort.current = null;
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [gateway, entry, clearPhotos],
  );
  const refresh = useCallback(() => read(cursor.current, false, false, true), [read]);
  const first = useCallback(() => read(null, true, false, true), [read]);
  const next = useCallback(() => {
    const page = current.current,
      last = page?.items.at(-1);
    if (page?.hasMore && last) return read({ time: last.submittedAt, id: last.id }, true);
  }, [read]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      const stop = () => {
        setDisplayActive(false);
        visible.current = false;
        activeGateway.current = null;
        generation.current++;
        abort.current?.abort();
        abort.current = null;
        pending.current = false;
        setLoading(false);
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
        current.current = saved.data?.page ?? null;
        cursor.current = saved.data?.cursor ?? null;
        setData(current.current);
        setHasPrevious(cursor.current !== null);
        if (!saved.data || !Number.isFinite(saved.updatedAt)) void refresh();
        else {
          const ids = current.current?.items.map((item) => item.id) ?? [];
          const cached = gateway.cachedPreviews?.(ids) ?? renderedPhotos.current;
          if (ids.some((id) => !Object.hasOwn(cached, id))) void read(cursor.current, false, true);
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
        if (!shouldRefresh && snapshot.data) return;
        invalidation = snapshot.invalidation;
        generation.current++;
        abort.current?.abort();
        pending.current = false;
        setLoading(false);
        if (!snapshot.data) {
          setData(null);
          current.current = null;
          clearPhotos();
        }
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
    }, [read, refresh, clearPhotos, gateway, entry]),
  );
  return {
    data,
    photos: displayActive ? photos : {},
    photoRevision,
    loading,
    error,
    photoError,
    refresh,
    first,
    next,
    hasPrevious,
  };
}
