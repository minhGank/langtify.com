import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafetyUnavailable } from './model';

// Screens are keyed by user/token. No read or write outlives that focused account.
type SafetyRun = <T>(
  work: (signal: AbortSignal) => Promise<T>,
  accept: (value: T) => void,
) => Promise<void>;
export function useSafetyTask(
  onReset: () => void,
  onResume?: (run: SafetyRun) => void,
  onUnavailable?: () => void,
) {
  const callbacks = useRef({ onReset, onResume, onUnavailable });
  useEffect(() => {
    callbacks.current = { onReset, onResume, onUnavailable };
  }, [onReset, onResume, onUnavailable]);
  const active = useRef(false),
    pending = useRef(false),
    generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T>(work: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
      if (!active.current || pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      const request = ++generation.current,
        current = new AbortController();
      controller.current = current;
      let cancel = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () =>
          reject(new Error('We couldn’t confirm the change. Refresh before trying again.'));
      });
      current.signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => current.abort(), 20000);
      try {
        const value = await Promise.race([work(current.signal), cancelled]);
        if (active.current && generation.current === request) accept(value);
      } catch (cause) {
        if (active.current && generation.current === request) {
          if (cause instanceof SafetyUnavailable)
            (callbacks.current.onUnavailable ?? callbacks.current.onReset)();
          setError(
            cause instanceof SafetyUnavailable
              ? cause.message
              : 'We couldn’t confirm the change. Refresh before trying again.',
          );
        }
      } finally {
        clearTimeout(timer);
        current.signal.removeEventListener('abort', cancel);
        if (generation.current === request) {
          pending.current = false;
          controller.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      const reset = () => {
        active.current = false;
        ++generation.current;
        controller.current?.abort();
        controller.current = null;
        pending.current = false;
        setBusy(false);
        setError(null);
        callbacks.current.onReset();
      };
      const resume = () => {
        active.current = true;
        callbacks.current.onResume?.(run);
      };
      if (AppState.currentState === 'active') resume();
      const listener = AppState.addEventListener('change', (state) => {
        if (!focused) return;
        if (state === 'active') {
          if (!active.current) resume();
        } else reset();
      });
      return () => {
        focused = false;
        listener.remove();
        reset();
      };
    }, [run]),
  );
  return { run, busy, error };
}
