import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { authSessionId } from '@/lib/auth-session-storage';
import { syncInstallation } from '@/services/notifications';
import * as device from './device';
import {
  installationWriter,
  learningTap,
  type LearningTap,
  type NotificationIdentity,
  type PushPermission,
} from './model';

const write = installationWriter({
  load: device.loadInstallation,
  save: device.saveInstallation,
  send: (value, identity, token, signal) =>
    syncInstallation(value, identity, token, device.devicePlatform, signal),
});
type State = {
  permission: PushPermission;
  busy: boolean;
  error: string | null;
  refresh: (request?: boolean, force?: boolean) => Promise<void>;
};
const Context = createContext<State | null>(null);
export function NotificationProvider({ children }: PropsWithChildren) {
  const { status, session } = useAuth();
  const root = useRootNavigationState();
  const current = useRef<NotificationIdentity | null>(null),
    binding = useRef('');
  const source = useRef('');
  const needsRevocation = useRef(true);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const [permission, setPermission] = useState<PushPermission>('unavailable'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [tap, setTap] = useState<LearningTap | null>(null);
  const handledTap = useRef<LearningTap | null>(null);
  const refresh = useCallback(async (request = false, force = false) => {
    if (force) binding.current = '';
    if (Platform.OS === 'web') return;
    controller.current?.abort();
    const active = new AbortController(),
      revision = ++generation.current;
    controller.current = active;
    const identity = current.current;
    const valid = () => !active.signal.aborted && generation.current === revision;
    setBusy(true);
    setError(null);
    const timer = setTimeout(() => {
      active.abort();
      if (generation.current === revision) {
        setBusy(false);
        setError('We couldn’t turn on reminders for this device. Try again.');
      }
    }, 15000);
    try {
      // Clear any persisted previous account before fallible native permission /
      // token lookups. The capability write also fences delayed registrations.
      if (needsRevocation.current) {
        await write(null, null, active.signal);
        if (!valid()) return;
        needsRevocation.current = false;
        binding.current = 'revoked';
      }
      const state = await device.permission(request && identity !== null);
      if (!valid()) return;
      setPermission(state);
      if (state === 'unavailable') return;
      const token = identity && state === 'granted' ? await device.pushToken() : null;
      if (!valid()) return;
      const signature =
        token && identity
          ? `${identity.userId}:${authSessionId(identity.token)}:${token}`
          : 'revoked';
      if (signature !== binding.current) {
        await write(token ? identity : null, token, active.signal);
        if (!valid()) return;
        binding.current = signature;
      }
      if (identity && state === 'granted' && !token)
        setError(
          'Reminders aren’t available in this build. You can still check Notifications in the app.',
        );
    } catch {
      if (valid()) setError('We couldn’t turn on reminders for this device. Try again.');
    } finally {
      clearTimeout(timer);
      if (generation.current === revision) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, []);
  useEffect(() => {
    const nextSource =
      status === 'ready' && session
        ? `${session.user.id}:${authSessionId(session.access_token)}`
        : status;
    if (source.current !== nextSource) {
      binding.current = '';
      needsRevocation.current = true;
      source.current = nextSource;
    }
    current.current =
      status === 'ready' && session
        ? { userId: session.user.id, token: session.access_token }
        : null;
    controller.current?.abort();
    if (status === 'loading' || status === 'unconfigured') return;
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [status, session, refresh]);
  useEffect(() => {
    let alive = true;
    const seen = new Set<string>();
    const stop = device.observe(
      (id, data) => {
        if (!alive || seen.has(id)) return;
        seen.add(id);
        if (seen.size > 32) seen.delete(seen.values().next().value ?? '');
        const value = learningTap(data);
        if (value) setTap(value);
        void device.clearResponses().catch(() => {});
      },
      () => {
        if (alive) {
          binding.current = '';
          void refresh();
        }
      },
      (data) => {
        const value = learningTap(data);
        return Boolean(value && current.current?.userId === value.userId);
      },
    );
    const listener = AppState.addEventListener('change', (state) => {
      if (alive && state === 'active') {
        // A provider may have invalidated this binding since the last foreground.
        binding.current = '';
        void refresh();
      }
    });
    return () => {
      alive = false;
      stop();
      listener.remove();
      controller.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!tap || handledTap.current === tap || !root?.key || status !== 'ready' || !session) return;
    handledTap.current = tap;
    if (tap.userId === session.user.id) router.replace('/(tabs)');
  }, [tap, root?.key, status, session]);
  useEffect(() => {
    if (status === 'signed-out' || status === 'error') void device.clearResponses().catch(() => {});
  }, [status]);
  return (
    <Context.Provider value={{ permission, busy, error, refresh }}>{children}</Context.Provider>
  );
}
export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error('Notification provider unavailable.');
  return value;
}
