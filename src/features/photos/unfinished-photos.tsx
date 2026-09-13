import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { listUnfinishedPhotos, type UnfinishedPhoto } from '@/services/submissions';

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
  const [photos, setPhotos] = useState<UnfinishedPhoto[]>([]);
  const [error, setError] = useState(false);
  const reload = useRef<(() => Promise<void>) | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true,
        generation = 0;
      const load = async () => {
        const request = ++generation;
        try {
          const saved = await listUnfinishedPhotos(userId, token);
          if (alive && request === generation) {
            setPhotos(saved);
            setError(false);
          }
        } catch {
          if (alive && request === generation) setError(true);
        }
      };
      reload.current = load;
      void load();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        alive = false;
        reload.current = null;
        listener.remove();
      };
    }, [userId, token]),
  );
  const earlier = photos.filter((photo) => !currentAssignments.includes(photo.assignmentId));
  if (!earlier.length && !error) return null;
  return (
    <>
      <AppText accessibilityRole="header">Unfinished photos</AppText>
      {earlier.map((photo) => (
        <Button
          key={photo.assignmentId}
          label={`Resume ${photo.targetTerm} photo`}
          onPress={() =>
            router.push({ pathname: '/photo', params: { assignmentId: photo.assignmentId } })
          }
        />
      ))}
      {error ? (
        <>
          <AppText>Unfinished photos could not be loaded.</AppText>
          <Button label="Retry unfinished photos" onPress={() => void reload.current?.()} />
        </>
      ) : null}
    </>
  );
}
