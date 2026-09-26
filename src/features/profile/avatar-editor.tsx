import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { MotionView } from '@/components/ui/motion-view';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { createServerCache, invalidateServerData, serverScope } from '@/lib/server-cache';
import { feedback } from '@/lib/haptics';
import { avatarGateway, type AvatarIdentity, type AvatarState } from '@/services/avatars';
import { pickAvatar, type PreparedAvatar } from './prepare-avatar';
import { ProfileAvatar } from './profile-avatar';

const metadata = createServerCache<AvatarState>({ maxEntries: 4 });
const discardUnavailable = () => true;
type Props = { identity: AvatarIdentity; username: string; onChanged: () => void };
export function AvatarEditor(props: Props) {
  return <Editor key={`${props.identity.userId}:${props.identity.token}`} {...props} />;
}
function Editor({ identity, username, onChanged }: Props) {
  const { colors } = useAppTheme();
  const api = useMemo(
    () => avatarGateway({ userId: identity.userId, token: identity.token }),
    [identity.userId, identity.token],
  );
  const entry = useMemo(
    () => metadata.entry(`${serverScope(identity.userId, identity.token)}:avatar`, ['avatars']),
    [identity.userId, identity.token],
  );
  const reconcile = useCallback(() => {
    invalidateServerData(['avatars', 'public-profile', 'user-search'], {
      discard: true,
      scope: serverScope(identity.userId, identity.token),
    });
  }, [identity.userId, identity.token]);
  const query = useServerQuery(
    entry,
    useCallback((signal: AbortSignal) => api.load(signal), [api]),
    { staleTime: 300000, discardOnError: discardUnavailable },
  );
  const [draft, setDraft] = useState<(PreparedAvatar & { requestId: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const working = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = AppState.currentState === 'active';
      working.current = false;
      setBusy(false);
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') active.current = true;
        if (state === 'background') {
          active.current = false;
          generation.current++;
          const saving = Boolean(controller.current);
          controller.current?.abort();
          controller.current = null;
          working.current = false;
          setBusy(false);
          if (saving) {
            reconcile();
            setError('We couldn’t confirm your profile photo was saved. Try again to check it.');
          }
        }
      });
      return () => {
        active.current = false;
        generation.current++;
        const saving = Boolean(controller.current);
        controller.current?.abort();
        if (saving) reconcile();
        listener.remove();
      };
    }, [reconcile]),
  );
  const choose = async () => {
    if (working.current || !active.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const version = ++generation.current;
    const current = () => active.current && generation.current === version;
    try {
      const photo = await pickAvatar(current);
      if (current() && photo) setDraft({ ...photo, requestId: randomUUID() });
    } catch {
      if (current()) setError('We couldn’t prepare this photo. Choose another.');
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
      }
    }
  };
  const save = async (removeId?: string) => {
    if (working.current || !active.current || (!draft && !removeId)) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const version = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    const current = () =>
      active.current && generation.current === version && !request.signal.aborted;
    try {
      let result: AvatarState;
      if (removeId) result = await api.remove(removeId, request.signal);
      else if (draft) {
        const reservation = await api.reserve(draft.requestId, request.signal);
        if (!current()) return;
        if (!reservation.current) await api.upload(reservation, draft.bytes, request.signal);
        if (!current()) return;
        result = await api.finalize(reservation.id, request.signal);
      } else return;
      if (!current()) return;
      reconcile();
      entry.set(result);
      setDraft(null);
      setConfirmRemove(false);
      setAcknowledgement((previous) => (previous ?? 0) + 1);
      if (removeId) feedback.confirm();
      else feedback.success();
      onChanged();
    } catch {
      if (current()) {
        // A failed acknowledgement does not prove the write failed. Refresh only
        // this session's current pointer; keep the same draft request for retry.
        reconcile();
        setConfirmRemove(false);
        setError(
          removeId
            ? 'We couldn’t confirm the photo was removed. Checking your profile…'
            : 'We couldn’t confirm your profile photo was saved. Try again to check it.',
        );
      }
    } finally {
      if (current()) {
        controller.current = null;
        working.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <View style={styles.section}>
      <View style={styles.photo}>
        <MotionView trigger={acknowledgement} kind="change">
          {draft ? (
            <Avatar username={username} uri={draft.uri} size={88} />
          ) : (
            <ProfileAvatar
              identity={identity}
              username={username}
              avatarId={query.data?.avatarId ?? null}
              size={88}
            />
          )}
        </MotionView>
        <Button
          label="Choose profile photo"
          variant="secondary"
          disabled={busy}
          onPress={() => void choose()}
        />
      </View>
      {draft && (
        <>
          <AppText variant="caption" style={{ color: colors.textSecondary }}>
            Shown on your public profile.
          </AppText>
          <Button
            label={error ? 'Retry saving photo' : 'Save photo'}
            loading={busy}
            onPress={() => void save()}
          />
          <Button
            label="Discard photo"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setDraft(null);
              setError(null);
            }}
          />
        </>
      )}
      {!draft && query.data?.avatarId && (
        <Button
          label="Remove profile photo"
          variant="ghost"
          disabled={busy}
          onPress={() => setConfirmRemove(true)}
        />
      )}
      {query.error && (
        <Button label="Reload profile photo" variant="ghost" onPress={() => void query.refresh()} />
      )}
      {error && (
        <AppText accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </AppText>
      )}
      <Sheet
        title="Remove profile photo?"
        visible={confirmRemove}
        onClose={() => {
          if (!busy) setConfirmRemove(false);
        }}
      >
        <AppText>Your initials will appear instead.</AppText>
        <Button
          label="Remove photo"
          variant="danger"
          loading={busy}
          onPress={() => {
            if (query.data?.avatarId) void save(query.data.avatarId);
          }}
        />
      </Sheet>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12 },
  photo: { alignItems: 'center', gap: 16, paddingVertical: 8 },
});
