import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { SafetyIdentity } from '@/features/safety/model';
import { useServerQuery } from '@/hooks/use-server-query';
import { imageMemory } from '@/lib/image-memory';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { avatarGateway } from '@/services/avatars';

const batches = createServerCache<string[]>({ maxEntries: 12 });
const discard = () => true;

// One controlled signing batch per page of missing avatars; rows never load
// profiles or sign individually. Only downloaded pixels survive navigation.
export function useConnectionAvatars(identity: SafetyIdentity, avatarIds: string[]) {
  const idsKey = [...new Set(avatarIds)].sort().join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const scope = serverScope(identity.userId, identity.token);
  const memory = useMemo(
    () => imageMemory(scope, 'avatar', ['avatars', 'public-profile']),
    [scope],
  );
  const gateway = useMemo(() => avatarGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      batches.entry(`${scope}:connection-avatars:${idsKey}`, ['avatars', 'connections', 'media']),
    [scope, idsKey],
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
        const signed = await gateway.previews(batch, signal);
        const pixels = await memory.resolve(
          Object.fromEntries(batch.map((id) => [id, signed[id] ?? null])),
          signal,
          started + 55000,
        );
        available.push(...batch.filter((id) => pixels[id]));
      }
      return available;
    },
    [gateway, ids, memory],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError: discard });
  return { photos: visible && query.data ? memory.cached(query.data) : {}, refresh: query.refresh };
}
