import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { useSessionState, type SessionGateway } from '@/features/auth/use-session-state';
import { supabase } from '@/lib/supabase';
import { OAuthBridge } from '@/features/auth/oauth/oauth-bridge';
import { restoreAuthSession, subscribeAuth } from '@/features/auth/oauth/runtime';
import { loadAccount } from '@/services/account';
import { useResumeRevalidation } from '@/hooks/use-resume-revalidation';

const gateway: SessionGateway | null = supabase
  ? {
      restore: restoreAuthSession,
      subscribe(listener) {
        return subscribeAuth((event, session) => listener(session, event));
      },
      loadAccount,
    }
  : null;

const AuthContext = createContext<ReturnType<typeof useSessionState> | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  useResumeRevalidation();
  const state = useSessionState(gateway);
  useEffect(() => {
    if (!supabase || Platform.OS === 'web') return;
    const client = supabase;
    const refresh = (status: string) => {
      if (status === 'active') void client.auth.startAutoRefresh();
      else void client.auth.stopAutoRefresh();
    };
    refresh(AppState.currentState);
    const listener = AppState.addEventListener('change', refresh);
    return () => {
      listener.remove();
      void client.auth.stopAutoRefresh();
    };
  }, []);
  return (
    <AuthContext.Provider value={state}>
      <OAuthBridge />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
