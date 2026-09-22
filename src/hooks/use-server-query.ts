import { useCallback, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ServerEntry } from '@/lib/server-cache';

export function useServerQuery<T>(
  entry: ServerEntry<T>,
  load: (signal: AbortSignal) => Promise<T>,
  {
    staleTime,
    discardOnError,
  }: { staleTime: number; discardOnError?: (cause: unknown) => boolean },
) {
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  const active = useRef<ServerEntry<T> | null>(null);
  const refresh = useCallback(async () => {
    if (active.current === entry)
      await entry.read(load, { staleTime, force: true, discardOnError });
  }, [entry, load, staleTime, discardOnError]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      let release: (() => void) | null = null;
      let invalidation = entry.getSnapshot().invalidation;
      const resume = () => {
        active.current = entry;
        release ??= entry.retain();
        const saved = entry.getSnapshot();
        if (saved.data === null || !Number.isFinite(saved.updatedAt))
          void entry.read(load, { staleTime, force: true, discardOnError });
      };
      if (AppState.currentState === 'active') resume();
      const unsubscribe = entry.subscribe(() => {
        const next = entry.getSnapshot().invalidation;
        if (next !== invalidation) {
          invalidation = next;
          if (focused && active.current === entry)
            void entry.read(load, { staleTime, discardOnError });
        }
      });
      const listener = AppState.addEventListener('change', (state) => {
        if (!focused) return;
        if (state === 'active') resume();
        else {
          active.current = null;
          release?.();
          release = null;
        }
      });
      return () => {
        focused = false;
        active.current = null;
        unsubscribe();
        listener.remove();
        release?.();
      };
    }, [entry, load, staleTime, discardOnError]),
  );
  return { ...snapshot, refresh };
}
