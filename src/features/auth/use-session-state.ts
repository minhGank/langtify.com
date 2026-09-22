import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { hasCompletedOnboarding, type SessionState } from '@/features/auth/session-state';
import type { Account } from '@/services/account';
import { serverScope, setServerScope } from '@/lib/server-cache';

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
  const refreshAccountRef = useRef<(() => Promise<void>) | null>(null);
  const refreshAccount = useCallback(async () => {
    if (!refreshAccountRef.current) throw new Error('Account is unavailable.');
    await refreshAccountRef.current();
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const activeGateway = gateway;
    let alive = true;
    let generation = 0;
    let acceptedSession: Session | null = null;
    let accountRead: { generation: number; work: Promise<void> } | null = null;
    let explicitRefresh: { generation: number; work: Promise<void> } | null = null;
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

    function readAccount(session: Session, request: number) {
      if (accountRead?.generation === request) return accountRead.work;
      const work = bounded(activeGateway.loadAccount(session.user.id)).then((account) => {
        if (!alive || request !== generation) return;
        setState({
          status: hasCompletedOnboarding(account, session.user.id) ? 'ready' : 'onboarding',
          session,
          account,
        });
      });
      accountRead = { generation: request, work };
      void work
        .finally(() => {
          if (accountRead?.work === work) accountRead = null;
        })
        .catch(() => {});
      return work;
    }
    refreshAccountRef.current = async () => {
      if (!alive || !acceptedSession) throw new Error('Account is unavailable.');
      // Refresh persisted account fields without resetting the protected router
      // or restoring/resubscribing Auth. Concurrent consumers share this read.
      const request = generation;
      const session = acceptedSession;
      if (explicitRefresh?.generation === request) return explicitRefresh.work;
      const prior = accountRead?.work;
      const work = (async () => {
        // An admission/token-refresh read may have started before the mutation.
        // Wait for it, then issue exactly one post-mutation read.
        if (prior) await prior.catch(() => {});
        if (!alive || generation !== request) return;
        await readAccount(session, request);
      })();
      explicitRefresh = { generation: request, work };
      try {
        await work;
      } finally {
        if (explicitRefresh?.work === work) explicitRefresh = null;
      }
    };

    function accept(session: Session | null) {
      const request = ++generation;
      if (!alive) return;
      acceptedSession = session;
      setServerScope(session ? serverScope(session.user.id, session.access_token) : null);
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
        readAccount(session, request).catch(() => {
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
      refreshAccountRef.current = null;
      ++generation;
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [gateway, revision]);

  return {
    ...state,
    refreshAccount,
    reload: () => {
      setState({ status: 'loading', session: null, account: null });
      setRevision((value) => value + 1);
    },
  };
}
