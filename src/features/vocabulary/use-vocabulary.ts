import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { HistoryCursor, VocabularyGateway, VocabularyPage } from '@/services/vocabulary';

// Keep only one bounded page and its photos in memory. The enclosing screen is
// account keyed; request generations also protect filter/token/focus transitions.
export function useVocabulary(gateway: VocabularyGateway) {
  const [data, setData] = useState<VocabularyPage | null>(null);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  const visible = useRef(false);
  const activeGateway = useRef<VocabularyGateway | null>(null);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0),
    cursor = useRef<HistoryCursor | null>(null);
  const current = useRef<VocabularyPage | null>(null);
  const pending = useRef(false);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPhotos = useCallback(() => {
    if (expiry.current) clearTimeout(expiry.current);
    expiry.current = null;
    setPhotos({});
  }, []);
  const read = useCallback(
    async (next: HistoryCursor | null, reset: boolean) => {
      if (!visible.current || activeGateway.current !== gateway) return;
      const request = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pending.current = true;
      cursor.current = next;
      setHasPrevious(next !== null);
      setLoading(true);
      setError(false);
      if (reset) {
        setData(null);
        current.current = null;
        clearPhotos();
      }
      try {
        const page = await gateway.load(next, controller.signal);
        if (request !== generation.current) return;
        current.current = page;
        setData(page);
        clearPhotos();
        setPhotoError(false);
        // Expiry begins BEFORE the signing request, conservatively bounding delayed responses.
        const started = performance.now();
        try {
          const signed = await gateway.previews(
            page.items.map((item) => item.id),
            controller.signal,
          );
          if (request !== generation.current) return;
          const remaining = 55000 - (performance.now() - started);
          if (remaining > 0) {
            setPhotos(signed);
            setPhotoRevision((revision) => revision + 1);
            expiry.current = setTimeout(() => {
              setPhotos({});
              setPhotoError(true);
            }, remaining);
            setPhotoError(Object.values(signed).some((uri) => uri === null));
          } else setPhotoError(true);
        } catch {
          if (request === generation.current) setPhotoError(true);
        }
      } catch {
        if (request === generation.current) {
          setData(null);
          current.current = null;
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
    [gateway, clearPhotos],
  );
  const refresh = useCallback(() => read(cursor.current, false), [read]);
  const first = useCallback(() => read(null, true), [read]);
  const next = useCallback(() => {
    const page = current.current,
      last = page?.items.at(-1);
    if (page?.hasMore && last) return read({ time: last.submittedAt, id: last.id }, true);
  }, [read]);
  useFocusEffect(
    useCallback(() => {
      cursor.current = null;
      activeGateway.current = gateway;
      visible.current = AppState.currentState === 'active';
      if (visible.current) void first();
      const listener = AppState.addEventListener('change', (state) => {
        visible.current = state === 'active';
        if (visible.current) void first();
        else {
          generation.current++;
          abort.current?.abort();
          abort.current = null;
          pending.current = false;
          clearPhotos();
          setData(null);
          current.current = null;
        }
      });
      const timer = setInterval(() => {
        if (visible.current && !pending.current) void refresh();
      }, 45000);
      return () => {
        visible.current = false;
        activeGateway.current = null;
        generation.current++;
        abort.current?.abort();
        abort.current = null;
        pending.current = false;
        listener.remove();
        clearInterval(timer);
        clearPhotos();
        setData(null);
        current.current = null;
      };
    }, [first, refresh, clearPhotos, gateway]),
  );
  return {
    data,
    photos,
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
