import { useCallback, useEffect, useRef, useState } from 'react';
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
export function useTodayChallenge(gateway: ChallengeGateway) {
  const [state, setState] = useState(initialState);
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
      if (!alive.current) return;
      if (writing.current) {
        // Resume/refocus must observe the settled write, not race ahead of it.
        if (!background) queuedRefresh.current = () => refreshChallenge();
        return;
      }
      if (background && reading.current) return;
      const request = ++generation.current;
      reading.current = true;
      if (!background) setState(initialState);
      try {
        const challenge = await gateway.load();
        if (alive.current && request === generation.current)
          setState({ ...initialState, challenge, loading: false });
      } catch (error) {
        if (alive.current && request === generation.current)
          setState({ ...initialState, loading: false, error: challengeError(error) });
      } finally {
        if (request === generation.current) reading.current = false;
      }
    },
    [gateway],
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
        if (alive.current && request === generation.current)
          setState({ ...initialState, loading: false, challenge });
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
    [gateway],
  );
  return { ...state, refresh, replace };
}
