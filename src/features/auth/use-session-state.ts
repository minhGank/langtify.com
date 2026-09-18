import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { hasCompletedOnboarding, type SessionState } from '@/features/auth/session-state';
import type { Account } from '@/services/account';

export type SessionGateway = {
  restore: () => Promise<Session | null>;
  subscribe: (listener: (session: Session | null, event: AuthChangeEvent) => void) => () => void;
  loadAccount: (userId: string) => Promise<Account>;
};

export function useSessionState(gateway: SessionGateway | null) {
  const [state, setState] = useState<SessionState>({
    status: gateway ? 'loading' : 'unconfigured',
    session: null,
    account: null,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!gateway) return;
    const activeGateway = gateway;
    let alive = true;
    let generation = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    async function bounded<T>(work: Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session request timed out.')), 15000);
        timers.add(timer);
      });
      try {
        return await Promise.race([work, deadline]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
          timers.delete(timer);
        }
      }
    }

    function accept(session: Session | null) {
      const request = ++generation;
      if (!alive) return;
      if (!session) {
        setState({ status: 'signed-out', session: null, account: null });
        return;
      }
      setState((previous) =>
        previous.session?.user.id === session.user.id &&
        (previous.status === 'ready' || previous.status === 'onboarding')
          ? { ...previous, session }
          : { status: 'loading', session, account: null },
      );
      // Leave Supabase's auth callback/lock before making another SDK request.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!alive || request !== generation) return;
        bounded(activeGateway.loadAccount(session.user.id))
          .then((account) => {
            if (!alive || request !== generation) return;
            setState({
              status: hasCompletedOnboarding(account, session.user.id) ? 'ready' : 'onboarding',
              session,
              account,
            });
          })
          .catch(() => {
            if (alive && request === generation)
              setState({ status: 'error', session, account: null });
          });
      }, 0);
      timers.add(timer);
    }

    const initialGeneration = generation;
    const unsubscribe = gateway.subscribe((session, event) => {
      // Supabase may emit INITIAL_SESSION(null) after a transient restore error.
      // The explicit restore result distinguishes that error from a real sign-out.
      if (event !== 'INITIAL_SESSION') accept(session);
    });
    bounded(gateway.restore())
      .then((session) => {
        // A sign-out/sign-in event takes precedence over a slower startup read.
        if (alive && generation === initialGeneration) accept(session);
      })
      .catch(() => {
        if (alive && generation === initialGeneration) {
          setState({ status: 'error', session: null, account: null });
        }
      });
    return () => {
      alive = false;
      ++generation;
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [gateway, revision]);

  return {
    ...state,
    reload: () => {
      setState({ status: 'loading', session: null, account: null });
      setRevision((value) => value + 1);
    },
  };
}
