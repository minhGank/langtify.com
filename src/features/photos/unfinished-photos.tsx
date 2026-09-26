import { displayTerm } from '@/utils/display-term';
import { useCallback, useMemo } from 'react';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { useServerQuery } from '@/hooks/use-server-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { listUnfinishedPhotos, type UnfinishedPhoto } from '@/services/submissions';

const cache = createServerCache<UnfinishedPhoto[]>({ maxEntries: 2 });

// Operation recovery, including prior dates; this is not a photo gallery/feed.
export function UnfinishedPhotos({
  userId,
  token,
  currentAssignments,
}: {
  userId: string;
  token: string;
  currentAssignments: string[];
}) {
  const { colors } = useAppTheme();
  const resource = useMemo(
    () => cache.entry(`${serverScope(userId, token)}:unfinished`, ['unfinished-photos']),
    [userId, token],
  );
  const load = useCallback(() => listUnfinishedPhotos(userId, token), [userId, token]);
  const { data, error, refresh } = useServerQuery(resource, load, { staleTime: 60000 });
  const photos = data ?? [];
  const earlier = photos.filter((photo) => !currentAssignments.includes(photo.assignmentId));
  if (!earlier.length && !error) return null;
  return (
    <View style={[styles.panel, { backgroundColor: colors.surfaceMuted }]}>
      <AppText variant="label">Photos in progress</AppText>
      {earlier.map((photo) => (
        <Button
          key={photo.assignmentId}
          variant="secondary"
          label={`Resume ${displayTerm(photo.targetTerm)} photo`}
          onPress={() =>
            router.push({ pathname: '/photo', params: { assignmentId: photo.assignmentId } })
          }
        />
      ))}
      {error ? (
        <>
          <AppText variant="caption">We couldn’t load your unfinished photos. Try again.</AppText>
          <Button variant="ghost" label="Try again" onPress={() => void refresh()} />
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ panel: { borderRadius: 20, padding: 16, gap: 12 } });
