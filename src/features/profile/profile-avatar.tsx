import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Avatar } from '@/components/ui/avatar';
import { avatarGateway, type AvatarIdentity } from '@/services/avatars';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { useServerQuery } from '@/hooks/use-server-query';
import { imageMemory } from '@/lib/image-memory';

const photos = createServerCache<{ available: boolean }>();
const discardPreview = () => true;
type Props = { identity: AvatarIdentity; username: string; avatarId: string | null; size?: number };
export function ProfileAvatar(props: Props) {
  return props.avatarId ? (
    <SignedAvatar
      key={`${serverScope(props.identity.userId, props.identity.token)}:${props.avatarId}`}
      {...props}
      avatarId={props.avatarId}
    />
  ) : (
    <Avatar username={props.username} size={props.size} />
  );
}
function SignedAvatar({ identity, username, avatarId, size }: Props & { avatarId: string }) {
  const [visible, setVisible] = useState(false);
  const memory = useMemo(
    () =>
      imageMemory(serverScope(identity.userId, identity.token), 'avatar', [
        'avatars',
        'public-profile',
      ]),
    [identity.userId, identity.token],
  );
  const api = useMemo(
    () => avatarGateway({ userId: identity.userId, token: identity.token }),
    [identity.userId, identity.token],
  );
  const entry = useMemo(
    () =>
      photos.entry(`${serverScope(identity.userId, identity.token)}:${avatarId}`, [
        'avatars',
        'public-profile',
        'media',
      ]),
    [identity.userId, identity.token, avatarId],
  );
  useFocusEffect(
    useCallback(() => {
      const display = () => {
        const current = entry.getSnapshot().data;
        if (current?.available && !memory.cached([avatarId])[avatarId])
          entry.invalidate({ discard: true });
        setVisible(AppState.currentState === 'active');
      };
      display();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') display();
        else setVisible(false);
      });
      return () => {
        setVisible(false);
        listener.remove();
      };
    }, [entry, memory, avatarId]),
  );
  const query = useServerQuery(
    entry,
    useCallback(
      async (signal: AbortSignal) => {
        if (memory.cached([avatarId])[avatarId]) return { available: true };
        const started = performance.now();
        const result = await api.previews([avatarId], signal);
        const pixels = await memory.resolve(
          { [avatarId]: result[avatarId] ?? null },
          signal,
          started + 55000,
        );
        return { available: Boolean(pixels[avatarId]) };
      },
      [api, avatarId, memory],
    ),
    { staleTime: Infinity, discardOnError: discardPreview },
  );
  const uri = visible && query.data?.available ? memory.cached([avatarId])[avatarId] : null;
  return <Avatar username={username} uri={uri} size={size} />;
}
