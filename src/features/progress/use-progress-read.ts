import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';

// Instances are keyed by account. Focus, token changes and unmount invalidate old reads.
export function useProgressRead<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const activeLoad = useRef<(() => Promise<T>) | null>(null);
  const refresh = useCallback(async () => {
    if (activeLoad.current !== load) return;
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
      let focused = true;
      const resume = () => {
        activeLoad.current = load;
        void refresh();
      };
      if (AppState.currentState === 'active') resume();
      const listener = AppState.addEventListener('change', (state) => {
        if (!focused) return;
        if (state === 'active') resume();
        else {
          activeLoad.current = null;
          generation.current++;
        }
      });
      const timer = setInterval(() => {
        if (focused && AppState.currentState === 'active') void refresh();
      }, 60000);
      return () => {
        focused = false;
        activeLoad.current = null;
        generation.current++;
        listener.remove();
        clearInterval(timer);
      };
    }, [load, refresh]),
  );
  return { data, error, refresh };
}
