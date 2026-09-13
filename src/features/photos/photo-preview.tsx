import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Switch, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
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
  return (
    <View style={styles.choice}>
      <AppText>Share with the Langtify community</AppText>
      <Switch
        accessibilityLabel="Share with the Langtify community"
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}
export function PhotoPreview({
  state,
  onTakePhoto,
  onRetake,
}: {
  state: ReturnType<typeof useAssignmentPhoto>;
  onTakePhoto: () => void;
  onRetake: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedUri, setLoadedUri] = useState<string | null>(null),
    [failedUri, setFailedUri] = useState<string | null>(null);
  const submission = state.data?.submission;
  const completed = submission?.status === 'completed',
    deleting = submission?.status === 'deleting';
  const preview = state.remoteUri ?? state.photo?.uri;
  const ready = !!preview && loadedUri === preview && failedUri !== preview;
  return (
    <>
      {preview ? (
        <>
          <Image
            key={preview}
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
            <ActivityIndicator accessibilityLabel="Loading photo preview" />
          ) : null}
          {failedUri === preview ? (
            <AppText accessibilityRole="alert">
              The photo could not be displayed. Refresh and review it before submitting.
            </AppText>
          ) : null}
        </>
      ) : null}
      {completed ? (
        <>
          <AppText>✓ Completed</AppText>
          <AppText>
            Submitted: {new Date(submission.submitted_at ?? submission.created_at).toLocaleString()}
          </AppText>
          <AppText>Visibility: {submission.visibility === 'public' ? 'Public' : 'Private'}</AppText>
          <VisibilityChoice
            value={submission.visibility === 'public'}
            disabled={state.busy}
            onChange={(value) => void state.changeVisibility(value ? 'public' : 'private')}
          />
        </>
      ) : deleting ? (
        <>
          <AppText>Deleting photo… The word becomes incomplete after deletion finishes.</AppText>
          <Button
            label="Finish deletion"
            loading={state.busy}
            onPress={() => void state.deletePhoto()}
          />
        </>
      ) : preview ? (
        <>
          <AppText>Review your photo before submitting.</AppText>
          <VisibilityChoice
            value={state.isPublic}
            disabled={state.busy}
            onChange={state.setPublic}
          />
          <AppText>
            {state.isPublic
              ? 'Public: eligible for a future community feed.'
              : 'Private: visible only to you.'}
          </AppText>
          <Button
            label="Submit photo"
            disabled={!ready}
            loading={state.busy}
            onPress={() => void state.submit()}
          />
          {!state.remoteUri && (
            <Button label="Retake photo" disabled={state.busy} onPress={onRetake} />
          )}
        </>
      ) : (
        <Button label="Take Photo" disabled={state.busy || state.loading} onPress={onTakePhoto} />
      )}
      {(submission || state.photo) && !deleting && (
        <Button
          label={completed ? 'Delete photo' : 'Discard photo'}
          disabled={state.busy}
          onPress={() => setConfirmDelete(true)}
        />
      )}
      {confirmDelete && (
        <>
          <AppText>
            Delete this photo? The word will be incomplete and you can take a new photo.
          </AppText>
          <Button
            label="Confirm delete photo"
            loading={state.busy}
            onPress={() => {
              setConfirmDelete(false);
              void state.deletePhoto();
            }}
          />
          <Button
            label="Keep photo"
            disabled={state.busy}
            onPress={() => setConfirmDelete(false)}
          />
        </>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  photo: { width: '100%', height: 340, borderRadius: 12 },
  choice: { gap: 8, alignItems: 'flex-start' },
});
