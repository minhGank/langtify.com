import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { SafetyIdentity } from '@/features/safety/model';
import { useServerQuery } from '@/hooks/use-server-query';
import { imageMemory } from '@/lib/image-memory';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { ownAvatarEntry } from '@/features/profile/avatar-state';
import { avatarGateway } from '@/services/avatars';

const batches = createServerCache<string[]>({ maxEntries: 12 });
const discard = () => true;

// One controlled signing batch per page of missing avatars; rows never load
// profiles or sign individually. Only downloaded pixels survive navigation.
export function useConnectionAvatars(
  identity: SafetyIdentity,
  avatarIds: string[],
  context?: 'blocked',
) {
  const idsKey = [...new Set(avatarIds)].sort().join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const scope = serverScope(identity.userId, identity.token);
  const memory = useMemo(
    () =>
      imageMemory(scope, context === 'blocked' ? 'blocked-avatar' : 'avatar', [
        'avatars',
        context === 'blocked' ? 'blocked-users' : 'public-profile',
      ]),
    [scope, context],
  );
  const entry = useMemo(
    () =>
      batches.entry(`${scope}:${context ?? 'public'}:connection-avatars:${idsKey}`, [
        'avatars',
        'connections',
        'media',
        ...(context === 'blocked' ? ['blocked-users'] : []),
        ...ids.map((id) => `avatar-access:${id}`),
      ]),
    [scope, idsKey, ids, context],
  );
  const [visible, setVisible] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const resume = () => {
        const cached = memory.cached(ids);
        if (entry.getSnapshot().data?.some((id) => !cached[id]))
          entry.invalidate({ discard: true });
        setVisible(AppState.currentState === 'active');
      };
      resume();
      const listener = AppState.addEventListener('change', (state) =>
        state === 'active' ? resume() : setVisible(false),
      );
      return () => {
        listener.remove();
        setVisible(false);
      };
    }, [entry, ids, memory]),
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      const cached = memory.cached(ids);
      const missing = ids.filter((id) => !cached[id]);
      const available = ids.filter((id) => cached[id]);
      for (let offset = 0; offset < missing.length; offset += 24) {
        if (signal.aborted) throw new Error('Avatar read cancelled.');
        const batch = missing.slice(offset, offset + 24);
        const started = performance.now();
        const gateway = avatarGateway(identity);
        const signed = context
          ? await gateway.previews(batch, signal, context)
          : await gateway.previews(batch, signal);
        const pixels = await memory.resolve(
          Object.fromEntries(batch.map((id) => [id, signed[id] ?? null])),
          signal,
          started + 55000,
        );
        available.push(...batch.filter((id) => pixels[id]));
      }
      return available;
    },
    [identity, ids, memory, context],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError: discard });
  return { photos: visible && query.data ? memory.cached(query.data) : {}, refresh: query.refresh };
}

// All author surfaces resolve identity here, then share one bounded pixel cache.
// Self identity comes from server-owned flags, never a username comparison.
export function useAvatarRows(
  identity: SafetyIdentity,
  rows: readonly { avatarId?: string | null; isSelf?: boolean }[],
) {
  const { userId, token } = identity;
  const entry = useMemo(() => ownAvatarEntry({ userId, token }), [userId, token]);
  const load = useCallback(
    (signal: AbortSignal) => avatarGateway({ userId, token }).load(signal),
    [userId, token],
  );
  const own = useServerQuery(entry, load, {
    staleTime: Infinity,
    discardOnError: discard,
    enabled: rows.some((row) => row.isSelf),
  });
  const resolveId = (row: { avatarId?: string | null; isSelf?: boolean }) =>
    row.isSelf && own.data ? own.data.avatarId : row.avatarId;
  const avatars = useConnectionAvatars(
    identity,
    rows.flatMap((row) => {
      const id = resolveId(row);
      return id ? [id] : [];
    }),
  );
  return {
    uri: (row: { avatarId?: string | null; isSelf?: boolean }) => {
      const id = resolveId(row);
      return id ? avatars.photos[id] : undefined;
    },
    refresh: async () => {
      await own.refresh();
      await avatars.refresh();
    },
  };
}
