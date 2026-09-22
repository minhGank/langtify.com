import { useEffect } from 'react';
import { AppState } from 'react-native';
import { invalidateServerData } from '@/lib/server-cache';

export const LONG_BACKGROUND_MS = 5 * 60 * 1000;
// Elapsed cache age never triggers this. Only an actual long background interval
// justifies reconciling other-device changes and public eligibility on return.
export function useResumeRevalidation() {
  useEffect(() => {
    let backgrounded: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && backgrounded === null) backgrounded = performance.now();
      if (state === 'active' && backgrounded !== null) {
        const elapsed = performance.now() - backgrounded;
        backgrounded = null;
        if (elapsed >= LONG_BACKGROUND_MS)
          invalidateServerData(
            [
              'media',
              'discover',
              'vocabulary',
              'public-profile',
              'user-search',
              'follows',
              'connections',
              'inbox',
              'comments',
              'avatars',
              'challenge',
              'progress',
              'unfinished-photos',
            ],
            { discard: true },
          );
      }
    });
    return () => subscription.remove();
  }, []);
}
