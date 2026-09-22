import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useSearchActive() {
  const current = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      current.current = AppState.currentState === 'active';
      const listener = AppState.addEventListener('change', (state) => {
        if (focused) current.current = state === 'active';
      });
      return () => {
        focused = false;
        current.current = false;
        listener.remove();
      };
    }, []),
  );
  return current;
}
