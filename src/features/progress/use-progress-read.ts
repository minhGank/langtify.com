import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';

// Instances are keyed by account. Focus, token changes and unmount invalidate old reads.
export function useProgressRead<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await load();
      if (request === generation.current) {
        setData(next);
        setError(false);
      }
    } catch {
      if (request === generation.current) {
        setData(null);
        setError(true);
      }
    }
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
        else generation.current++;
      });
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refresh();
      }, 60000);
      return () => {
        generation.current++;
        listener.remove();
        clearInterval(timer);
      };
    }, [refresh]),
  );
  return { data, error, refresh };
}
