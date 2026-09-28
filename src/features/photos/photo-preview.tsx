import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { displayTerm } from '@/utils/display-term';
import type { useAssignmentPhoto } from './use-assignment-photo';
import { PhotoOptions } from './photo-options';

export function PhotoPreview({
  state,
  onTakePhoto,
  onRetake,
  onChooseLibrary,
  onPreviewReady,
  choosing = false,
}: {
  state: ReturnType<typeof useAssignmentPhoto>;
  onTakePhoto: () => void;
  onRetake: () => void;
  onChooseLibrary?: () => void;
  choosing?: boolean;
  onPreviewReady: (uri: string | null) => void;
}) {
  const { colors } = useAppTheme();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const submission = state.data?.submission;
  const completed = submission?.status === 'completed';
  const deleting = submission?.status === 'deleting';
  const preview = state.remoteUri ?? state.photo?.uri;
  const ready = !!preview && loadedUri === preview && failedUri !== preview;
  useEffect(() => {
    onPreviewReady(ready ? preview : null);
  }, [ready, preview, onPreviewReady]);
  return (
    <>
      {preview ? (
        <View style={[styles.photoFrame, { backgroundColor: colors.surfaceMuted }]}>
          <Image
            key={`${preview}:${previewAttempt}`}
            source={{ uri: preview }}
            accessibilityLabel="Your challenge photo"
            style={styles.photo}
            resizeMode="contain"
            onLoad={() => {
              setLoadedUri(preview);
              setFailedUri(null);
            }}
            onError={() => setFailedUri(preview)}
          />
          {!ready && failedUri !== preview ? (
            <ActivityIndicator
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Loading photo preview"
              color={colors.brandPrimary}
            />
          ) : null}
          {failedUri === preview ? (
            <View style={styles.previewError}>
              <AppText accessibilityRole="alert">
                We couldn’t display this photo. Try reloading it.
              </AppText>
              <Button
                label="Reload photo"
                variant="secondary"
                onPress={() => {
                  setFailedUri(null);
                  setLoadedUri(null);
                  setPreviewAttempt((value) => value + 1);
                  void state.refresh();
                }}
              />
            </View>
          ) : null}
        </View>
      ) : !completed && !deleting ? (
        <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="camera-outline" size={44} color={colors.textSecondary} />
          <AppText variant="caption">Take a photo or choose one from your library.</AppText>
        </View>
      ) : null}

      <View style={styles.context}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading">{displayTerm(state.data?.targetTerm ?? '')}</AppText>
          <AppText style={{ color: colors.textSecondary }}>
            {displayTerm(state.data?.referenceTerm ?? '')}
          </AppText>
        </View>
        {(preview || submission) && !deleting && (
          <PhotoOptions
            state={state}
            choosing={choosing}
            onRetake={onRetake}
            onChooseLibrary={onChooseLibrary}
          />
        )}
      </View>
      {deleting ? (
        <>
          <AppText>
            This photo hasn’t finished deleting. Finish deleting it before adding another.
          </AppText>
          <Button
            label="Finish deleting"
            loading={state.busy}
            onPress={() => void state.deletePhoto()}
          />
        </>
      ) : !preview ? (
        <>
          <Button
            label="Take photo"
            disabled={state.busy || state.loading || choosing || !state.data?.canCapture}
            onPress={onTakePhoto}
          />
          {onChooseLibrary && (
            <Button
              label="Choose from library"
              variant="secondary"
              disabled={state.busy || state.loading || choosing}
              onPress={onChooseLibrary}
            />
          )}
        </>
      ) : null}
      {!completed && !deleting && state.data && !state.data.canCapture && (
        <AppText variant="caption">
          You can’t add a photo to this word right now. Refresh Vocabulary or Today.
        </AppText>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  photoFrame: { borderRadius: 24, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 3 / 4, maxHeight: 460 },
  previewError: { padding: 16, gap: 12 },
  empty: {
    minHeight: 210,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  context: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
