import AsyncStorage from '@react-native-async-storage/async-storage';
import { type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { publicConfig } from '@/lib/env';
import { requireSupabase } from '@/lib/supabase';
import { authSessionId, guardSessionWrites } from '@/lib/auth-session-storage';
import { browserCoordination, type BrowserCoordination } from './browser-coordination';
import { createOAuthAttempt } from './pkce-attempt';
import { appScheme, callbackPath } from './callback';
import { OAuthCoordinator, type OAuthAttempt, type PendingLogin } from './coordinator';

export function oauthRedirect() {
  return makeRedirectUri({ scheme: appScheme, path: callbackPath });
}
const config = publicConfig.config;
const prefix = `langtify-oauth:${config?.url ?? 'unconfigured'}:`;
const pendingKey = `${prefix}pending`;
function browserAuthority(): BrowserCoordination | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (!navigator.locks) return null;
  try {
    const authority = browserCoordination(window.localStorage, navigator.locks, prefix);
    // Access can be denied even when the localStorage property exists.
    window.localStorage.getItem(`${prefix}:intent`);
    return authority;
  } catch {
    return null;
  }
}
function hasBrowserPKCEStorage() {
  try {
    window.sessionStorage.getItem(pendingKey);
    return true;
  } catch {
    return false;
  }
}
export const googleLoginUnavailable =
  Platform.OS !== 'web' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? 'Google sign-in isn’t available in Expo Go. Open the installed Langtify app.'
    : Platform.OS === 'web' && (!browserAuthority() || !hasBrowserPKCEStorage())
      ? 'Google sign-in isn’t available in this browser. Try another browser or the Langtify app.'
      : null;
const store = {
  async getItem(key: string) {
    if (Platform.OS !== 'web') return AsyncStorage.getItem(key);
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    } // no PKCE verifier; password restoration remains available
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') window.sessionStorage.setItem(key, value);
    else await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') window.sessionStorage.removeItem(key);
    else await AsyncStorage.removeItem(key);
  },
  async keys() {
    return Platform.OS === 'web'
      ? Object.keys(window.sessionStorage)
      : [...(await AsyncStorage.getAllKeys())];
  },
};
let storageTail: Promise<unknown> = Promise.resolve();
function storageTask<T>(work: () => Promise<T>): Promise<T> {
  const next = storageTail.then(work, work);
  storageTail = next.catch(() => {});
  return next;
}
async function readPending(): Promise<PendingLogin | null> {
  const raw = await store.getItem(pendingKey);
  if (!raw) return null;
  try {
    const row: unknown = JSON.parse(raw);
    if (
      !row ||
      typeof row !== 'object' ||
      !('id' in row) ||
      typeof row.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(row.id) ||
      !('createdAt' in row) ||
      typeof row.createdAt !== 'number' ||
      !Number.isFinite(row.createdAt) ||
      !('redirect' in row) ||
      typeof row.redirect !== 'string' ||
      !('phase' in row) ||
      (row.phase !== 'preparing' &&
        row.phase !== 'waiting' &&
        row.phase !== 'exchanging' &&
        row.phase !== 'committing' &&
        row.phase !== 'cancelled')
    )
      return null;
    const flowId =
      'flowId' in row && typeof row.flowId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(row.flowId)
        ? row.flowId
        : undefined;
    const candidateUserId =
      'candidateUserId' in row && typeof row.candidateUserId === 'string'
        ? row.candidateUserId
        : undefined;
    const candidateSessionId =
      'candidateSessionId' in row && typeof row.candidateSessionId === 'string'
        ? row.candidateSessionId
        : undefined;
    return {
      id: row.id,
      createdAt: row.createdAt,
      redirect: row.redirect,
      phase: row.phase,
      flowId,
      candidateUserId,
      candidateSessionId,
    };
  } catch {
    return null;
  }
}
const attempts = new Map<string, OAuthAttempt>();
function attempt(id: string): OAuthAttempt {
  const cached = attempts.get(id);
  if (cached) return cached;
  if (!config) throw new Error('Auth configuration unavailable.');
  const key = `${prefix}${id}`;
  let client: OAuthAttempt | null = null;
  const sdk = () => (client ??= createOAuthAttempt(config, key, store));
  const value: OAuthAttempt = {
    authorize: (redirect) => sdk().authorize(redirect),
    exchange: (code, flowId) => sdk().exchange(code, flowId),
    clear: async () => {
      if (client) await client.clear();
      for (const name of await store.keys())
        if (name === key || name.startsWith(`${key}-`)) await store.removeItem(name);
      attempts.delete(id);
    },
  };
  attempts.set(id, value);
  return value;
}
let mutationTail: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = () => browserAuthority()?.run(work) ?? work();
  const next = mutationTail.then(run, run);
  mutationTail = next.catch(() => {});
  return next;
}
type Listener = (event: AuthChangeEvent, session: Session | null) => void;
const listeners = new Set<Listener>();
let unsubscribe: (() => void) | null = null;
let installation: { sessionId: string; release: () => void } | null = null;
let restorationChecked = false;
let startupEvent: { event: AuthChangeEvent; session: Session } | null = null;
function finishRestoration() {
  restorationChecked = true;
  const pending = startupEvent;
  startupEvent = null;
  if (pending) emit(pending.event, pending.session);
}
function emit(event: AuthChangeEvent, session: Session | null) {
  listeners.forEach((listener) => listener(event, session));
}
function connect() {
  if (unsubscribe || !config) return;
  const { data } = requireSupabase().auth.onAuthStateChange((event, session) => {
    if (
      installation &&
      session &&
      authSessionId(session.access_token) === installation.sessionId &&
      event !== 'SIGNED_OUT'
    ) {
      return;
    }
    if (Platform.OS === 'web' && event !== 'INITIAL_SESSION') {
      // SDK broadcasts precede local admission. Wait for the originating tab's
      // mutation/rollback, then accept only the session still present in storage.
      void serialize(async () => {
        const saved = await readAuthSession();
        if (
          session
            ? !saved || authSessionId(session.access_token) !== authSessionId(saved.access_token)
            : saved
        )
          return;
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') coordinator.accountChanged();
        emit(event, saved);
      }).catch(() => {});
      return;
    }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') coordinator.accountChanged();
    // Refresh can race the first AsyncStorage read. Do not admit a session until
    // interrupted-install recovery has inspected its durable marker.
    if (!restorationChecked && session && event !== 'INITIAL_SESSION') {
      startupEvent = { event, session };
      return;
    }
    if (event === 'SIGNED_OUT') startupEvent = null;
    emit(event, session);
  });
  unsubscribe = () => data.subscription.unsubscribe();
}
export function subscribeAuth(listener: Listener) {
  connect();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function authMutation<T>(work: () => Promise<T>): Promise<T> {
  browserAuthority()?.begin(Crypto.randomUUID());
  const cancelled = coordinator.cancel('').then(
    () => true,
    () => false,
  );
  return serialize(async () => {
    if (!(await cancelled)) throw new Error('OAuth cancellation could not be persisted.');
    if (installation) await readAuthSession();
    return work();
  });
}
async function install(
  candidate: Session,
  current: () => boolean,
  finish: () => Promise<void>,
  retain: () => Promise<void>,
) {
  await serialize(async () => {
    connect();
    const auth = requireSupabase().auth;
    const { data, error } = await auth.getSession();
    if (error || data.session || !current()) {
      await finish(); // setSession has not run; no interrupted commit exists.
      throw new Error('Session changed.');
    }
    const sessionId = authSessionId(candidate.access_token);
    if (!sessionId) {
      await finish();
      throw new Error('Invalid Auth session.');
    }
    const browser = browserAuthority();
    browser?.commit({ sessionId, userId: candidate.user.id });
    const release = guardSessionWrites({ sessionId, current });
    installation = { sessionId, release };
    try {
      const result = await auth.setSession({
        access_token: candidate.access_token,
        refresh_token: candidate.refresh_token,
      });
      if (result.error || !result.data.session || !current()) throw new Error('Session changed.');
      await finish();
      if (!current()) throw new Error('Session changed.');
      const accepted = result.data.session;
      browser?.commit(null);
      release();
      installation = null;
      emit('SIGNED_IN', accepted);
    } catch {
      // Preserve the recovery marker and quarantine events if local cleanup fails.
      browser?.commit({ sessionId, userId: candidate.user.id });
      await retain();
      const saved = await auth.getSession();
      if (saved.error) throw new Error('OAuth cleanup required.');
      if (saved.data.session && authSessionId(saved.data.session.access_token) === sessionId) {
        const removed = await auth.signOut({ scope: 'local' });
        if (removed.error) throw new Error('OAuth cleanup required.');
      }
      await finish();
      browser?.commit(null);
      release();
      installation = null;
      throw new Error('OAuth installation failed.');
    }
  });
}
async function readAuthSession() {
  const auth = requireSupabase().auth;
  const { data, error } = await auth.getSession();
  if (error) throw error;
  const pending = await storageTask(readPending);
  let restored = data.session;
  // Match the Auth session, not just its owner: a newer password login to the
  // same UUID must survive recovery of an abandoned Google login.
  const browser = browserAuthority();
  const shared = browser?.pending();
  const interrupted = pending?.phase === 'committing' ? pending : null;
  const sessionId = shared?.sessionId ?? interrupted?.candidateSessionId ?? installation?.sessionId;
  const legacyOwner = !sessionId ? interrupted?.candidateUserId : null;
  if (shared || interrupted || installation) {
    if (
      restored &&
      (sessionId
        ? authSessionId(restored.access_token) === sessionId
        : restored.user.id === legacyOwner)
    ) {
      const signedOut = await auth.signOut({ scope: 'local' });
      if (signedOut.error) throw signedOut.error;
      restored = null;
    }
    if (interrupted) {
      await attempt(interrupted.id).clear();
      await storageTask(async () => {
        if ((await readPending())?.id === interrupted.id) await store.removeItem(pendingKey);
      });
    }
    browser?.commit(null);
    installation?.release();
    installation = null;
  }
  finishRestoration();
  return restored;
}
export function restoreAuthSession() {
  return serialize(readAuthSession);
}
export const coordinator = new OAuthCoordinator({
  apiUrl: config?.url ?? '',
  redirect: oauthRedirect,
  randomId: Crypto.randomUUID,
  now: Date.now,
  begin: (id) => {
    if (Platform.OS === 'web' && !browserAuthority())
      throw new Error('Secure browser coordination unavailable.');
    browserAuthority()?.begin(id);
  },
  isCurrent: (id) => browserAuthority()?.current(id) ?? Platform.OS !== 'web',
  invalidate: (id) => browserAuthority()?.invalidate(id),
  read: () => storageTask(readPending),
  write: (pending) => storageTask(() => store.setItem(pendingKey, JSON.stringify(pending))),
  remove: (id) =>
    storageTask(async () => {
      if ((await readPending())?.id === id) await store.removeItem(pendingKey);
    }),
  attempt,
  session: restoreAuthSession,
  install,
  async browser(url, redirect) {
    if (Platform.OS === 'web') {
      window.location.assign(url);
      return new Promise(() => {});
    }
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
      throw new Error('Development build required.');
    return WebBrowser.openAuthSessionAsync(url, redirect);
  },
  dismiss: () => {
    if (Platform.OS !== 'web') {
      try {
        WebBrowser.dismissAuthSession();
      } catch {
        /* already closed */
      }
    }
  },
});
