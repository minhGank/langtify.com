import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { useSessionState, type SessionGateway } from '@/features/auth/use-session-state';
import { supabase } from '@/lib/supabase';
import { loadAccount } from '@/services/account';

const gateway: SessionGateway | null = supabase
  ? {
      async restore() {
        if (!supabase) return null;
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
      },
      subscribe(listener) {
        const subscription = supabase?.auth.onAuthStateChange((event, session) =>
          listener(session, event),
        );
        return () => subscription?.data.subscription.unsubscribe();
      },
      loadAccount,
    }
  : null;

const AuthContext = createContext<ReturnType<typeof useSessionState> | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
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
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
