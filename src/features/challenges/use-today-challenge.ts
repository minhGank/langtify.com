import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createServerCache, isolatedCacheKey } from '@/lib/server-cache';
import { challengeError } from '@/features/challenges/errors';
import type { ChallengeGateway, TodayChallenge } from '@/services/challenges';

type State = {
  challenge: TodayChallenge | null;
  loading: boolean;
  replacing: string | null;
  error: string;
  replacementError: string;
};
const initialState: State = {
  challenge: null,
  loading: true,
  replacing: null,
  error: '',
  replacementError: '',
};
function calendarDay(timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return 'unknown';
  }
}
const cache = createServerCache<{ challenge: TodayChallenge; observedDay: string }>({
  maxEntries: 4,
});
export function useTodayChallenge(gateway: ChallengeGateway, cacheKey?: string) {
  const entry = useMemo(
    () => cache.entry(cacheKey ?? isolatedCacheKey(gateway), ['challenge']),
    [cacheKey, gateway],
  );
  useEffect(() => entry.retain(), [entry]);
  const [state, setState] = useState(() => ({
    ...initialState,
    challenge: entry.getSnapshot().data?.challenge ?? null,
  }));
  const generation = useRef(0);
  const reading = useRef(false);
  const writing = useRef(false);
  const alive = useRef(true);
  const queuedRefresh = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current = generation.current + 1;
      queuedRefresh.current = null;
    };
  }, []);
  const refresh = useCallback(
    async function refreshChallenge(background = false): Promise<void> {
      if (!alive.current || entry.getSnapshot().retired) return;
      if (writing.current) {
        // Resume/refocus must observe the settled write, not race ahead of it.
        if (!background) queuedRefresh.current = () => refreshChallenge();
        return;
      }
      if (reading.current) return;
      const request = ++generation.current;
      reading.current = true;
      if (!background) setState((previous) => ({ ...previous, loading: true, error: '' }));
      try {
        const challenge = await gateway.load();
        if (alive.current && request === generation.current) {
          entry.set({ challenge, observedDay: calendarDay(challenge.timezone) });
          setState({ ...initialState, challenge, loading: false });
        }
      } catch (error) {
        if (alive.current && request === generation.current)
          setState((previous) => ({ ...previous, loading: false, error: challengeError(error) }));
      } finally {
        if (request === generation.current) reading.current = false;
      }
    },
    [gateway, entry],
  );
  useEffect(() => {
    generation.current = generation.current + 1;
    reading.current = false;
    // Today remounts across account/configuration changes. A new token within the
    // same instance must still reconcile any write made with the preceding token.
    if (writing.current) queuedRefresh.current = () => refresh();
  }, [refresh]);
  const replace = useCallback(
    async (id: string) => {
      if (!alive.current || writing.current) return;
      writing.current = true;
      reading.current = false;
      const request = ++generation.current;
      setState((previous) => ({ ...previous, replacing: id, replacementError: '' }));
      try {
        const challenge = await gateway.replace(id);
        if (alive.current && request === generation.current) {
          entry.set({ challenge, observedDay: calendarDay(challenge.timezone) });
          setState({ ...initialState, loading: false, challenge });
        }
      } catch (error) {
        if (alive.current && request === generation.current)
          setState((previous) => ({
            ...previous,
            replacing: null,
            replacementError: challengeError(error, true),
          }));
      } finally {
        writing.current = false;
        const refreshAfterWrite = queuedRefresh.current;
        queuedRefresh.current = null;
        if (alive.current && refreshAfterWrite) await refreshAfterWrite();
      }
    },
    [gateway, entry],
  );
  const ensureFresh = useCallback(async () => {
    const saved = entry.getSnapshot();
    const cached = saved.data;
    if (
      cached &&
      Number.isFinite(saved.updatedAt) &&
      cached.observedDay === calendarDay(cached.challenge.timezone)
    ) {
      setState((previous) => ({ ...previous, challenge: cached.challenge, loading: false }));
      return;
    }
    await refresh(true);
  }, [entry, refresh]);
  return { ...state, refresh, ensureFresh, replace, subscribe: entry.subscribe };
}
