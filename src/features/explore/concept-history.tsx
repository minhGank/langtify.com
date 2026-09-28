import { useCallback, useMemo } from 'react';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { useServerQuery } from '@/hooks/use-server-query';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { vocabularyGateway } from '@/services/vocabulary';
import type { ExploreIdentity } from '@/services/explore';

const counts = createServerCache<number>({ maxEntries: 24 });
export function ConceptHistory({
  identity,
  conceptId,
  hasCaptures,
}: {
  identity: ExploreIdentity;
  conceptId: string;
  hasCaptures?: boolean;
}) {
  const entry = useMemo(
    () =>
      counts.entry(`${serverScope(identity.userId, identity.token)}:concept-history:${conceptId}`, [
        'vocabulary',
      ]),
    [identity, conceptId],
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await vocabularyGateway(identity.userId, identity.token, {
        conceptId,
        search: '',
        level: '',
      }).load(null, signal);
      return page.concept?.captureCount ?? 0;
    },
    [identity, conceptId],
  );
  const query = useServerQuery(entry, load, {
    staleTime: Infinity,
    enabled: hasCaptures === undefined,
  });
  if (!(hasCaptures ?? (query.data ?? 0) > 0)) return null;
  return (
    <Button
      label={query.data ? `Your photos · ${query.data}` : 'Your photos'}
      variant="ghost"
      onPress={() => router.push({ pathname: '/vocabulary-concept', params: { conceptId } })}
    />
  );
}
