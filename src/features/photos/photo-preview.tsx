import { displayTerm } from '@/utils/display-term';
import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { useAssignmentPhoto } from './use-assignment-photo';

function VisibilityChoice({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.choice, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons
        name={value ? 'globe-outline' : 'lock-closed-outline'}
        size={22}
        color={colors.muted}
      />
      <View style={styles.choiceText}>
        <AppText variant="label">Share in Discover</AppText>
        <AppText variant="caption">
          {value ? 'Visible to other learners' : 'Private · only you'}
        </AppText>
      </View>
      <Switch
        accessibilityLabel="Share with the Langtify community"
        accessibilityState={{ disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );
}
export function PhotoPreview({
  state,
  onTakePhoto,
  onRetake,
  onChooseLibrary,
  choosing = false,
}: {
  state: ReturnType<typeof useAssignmentPhoto>;
  onTakePhoto: () => void;
  onRetake: () => void;
  onChooseLibrary?: () => void;
  choosing?: boolean;
}) {
  const { colors } = useAppTheme();
  const [sheet, setSheet] = useState<'options' | 'delete' | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [loadedUri, setLoadedUri] = useState<string | null>(null),
    [failedUri, setFailedUri] = useState<string | null>(null);
  const submission = state.data?.submission;
  const historical = state.data?.captureKind === 'historical';
  const completed = submission?.status === 'completed',
    deleting = submission?.status === 'deleting';
  const preview = state.remoteUri ?? state.photo?.uri;
  const ready = !!preview && loadedUri === preview && failedUri !== preview;
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
              color={colors.primary}
            />
          ) : null}
          {failedUri === preview ? (
            <View style={styles.previewError}>
              <AppText accessibilityRole="alert">The photo could not be displayed.</AppText>
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
          <Ionicons name="camera-outline" size={44} color={colors.muted} />
          <AppText variant="caption">Capture this word in your world.</AppText>
        </View>
      ) : null}
      <View style={styles.context}>
        <View style={styles.choiceText}>
          <AppText variant="heading">{displayTerm(state.data?.targetTerm ?? '')}</AppText>
          <AppText style={{ color: colors.muted }}>
            {displayTerm(state.data?.referenceTerm ?? '')}
          </AppText>
        </View>
        {completed && (
          <IconButton
            label="Photo options"
            name="ellipsis-horizontal"
            variant="surface"
            disabled={state.busy}
            onPress={() => setSheet('options')}
          />
        )}
      </View>
      {completed ? (
        <View style={styles.context}>
          <View style={styles.status}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <AppText variant="caption" style={{ color: colors.success }}>
              {historical ? 'Added to Vocabulary' : 'Completed'}
            </AppText>
          </View>
          <AppText variant="caption">
            {submission.visibility === 'public' ? 'Public' : 'Private'}
          </AppText>
        </View>
      ) : deleting ? (
        <View style={styles.group}>
          <AppText>Deletion is unfinished. Complete it to make this word available again.</AppText>
          <Button
            label="Finish deletion"
            loading={state.busy}
            onPress={() => void state.deletePhoto()}
          />
        </View>
      ) : preview ? (
        <>
          <VisibilityChoice
            value={state.isPublic}
            disabled={state.busy || choosing}
            onChange={state.setPublic}
          />
          <Button
            label="Submit photo"
            disabled={!ready || choosing || !state.data?.canCapture}
            loading={state.busy}
            onPress={() => void state.submit()}
          />
          <View style={styles.actions}>
            {!state.remoteUri && (
              <View style={styles.action}>
                <Button
                  label="Retake photo"
                  variant="secondary"
                  disabled={state.busy || choosing || !state.data?.canCapture}
                  onPress={onRetake}
                />
              </View>
            )}
            <View style={styles.action}>
              <Button
                label="Discard photo"
                variant="ghost"
                disabled={state.busy || choosing}
                onPress={() => setSheet('delete')}
              />
            </View>
          </View>
          {!state.remoteUri && onChooseLibrary && (
            <Button
              label="Choose another photo"
              variant="ghost"
              disabled={state.busy || choosing}
              onPress={onChooseLibrary}
            />
          )}
        </>
      ) : (
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
      )}
      {!completed && !deleting && state.data && !state.data.canCapture && (
        <AppText variant="caption">
          This word is not available for a new photo. Return to Vocabulary or Today to refresh.
        </AppText>
      )}
      {submission && !completed && !deleting && !preview && (
        <Button
          label="Discard photo"
          variant="ghost"
          disabled={state.busy || choosing}
          onPress={() => setSheet('delete')}
        />
      )}
      <Sheet
        title={
          sheet === 'delete'
            ? completed
              ? 'Delete this photo?'
              : 'Discard this photo?'
            : 'Photo options'
        }
        visible={sheet !== null}
        onClose={() => setSheet(null)}
      >
        {sheet === 'delete' ? (
          <>
            <AppText>
              {completed
                ? 'This removes your photo and its earned progress. You can capture this word again.'
                : 'Your unsaved photo will be removed. You can take another one.'}
            </AppText>
            <Button
              label={completed ? 'Delete photo' : 'Discard photo'}
              accessibilityLabel="Confirm delete photo"
              variant="danger"
              loading={state.busy}
              onPress={() => {
                setSheet(null);
                void state.deletePhoto();
              }}
            />
            <Button
              label="Keep photo"
              variant="secondary"
              disabled={state.busy}
              onPress={() => setSheet(null)}
            />
          </>
        ) : (
          <>
            {submission && (
              <VisibilityChoice
                value={submission.visibility === 'public'}
                disabled={state.busy}
                onChange={(value) => void state.changeVisibility(value ? 'public' : 'private')}
              />
            )}
            {state.error && (
              <View style={styles.group}>
                <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
                  {state.error}
                </AppText>
                <Button
                  label="Check saved visibility"
                  variant="secondary"
                  disabled={state.busy}
                  onPress={() => void state.refresh()}
                />
              </View>
            )}
            <View style={styles.group}>
              <AppText variant="caption">Challenge · {state.data?.localDate}</AppText>
              {submission && (
                <AppText variant="caption">
                  Submitted ·{' '}
                  {new Date(submission.submitted_at ?? submission.created_at).toLocaleString()}
                </AppText>
              )}
            </View>
            <Button
              label="Delete photo"
              variant="danger"
              disabled={state.busy}
              onPress={() => setSheet('delete')}
            />
          </>
        )}
      </Sheet>
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
  choice: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  choiceText: { flex: 1, gap: 4 },
  context: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  group: { gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
