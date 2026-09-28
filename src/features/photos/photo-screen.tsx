import { displayTerm } from '@/utils/display-term';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { openCompletedPost } from '@/features/discover/owned-post-access';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { IconButton } from '@/components/ui/icon-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { photoGateway, type CaptureKind } from '@/services/submissions';
import { CameraCapture } from './camera-capture';
import { PhotoPreview } from './photo-preview';
import { VisibilityChoice } from './visibility-choice';
import { loadDraft, preparePhoto, removeDraft } from './photo-files';
import { useAssignmentPhoto } from './use-assignment-photo';
import { useLibraryPhoto } from './use-library-photo';
import { serverScope } from '@/lib/server-cache';

export function PhotoScreen() {
  const { session, status } = useAuth();
  const { assignmentId, capture, captureKind } = useLocalSearchParams<{
    assignmentId?: string | string[];
    capture?: string | string[];
    captureKind?: string | string[];
  }>();
  if (
    status !== 'ready' ||
    !session ||
    typeof assignmentId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(assignmentId) ||
    (captureKind !== undefined && captureKind !== 'daily' && captureKind !== 'historical')
  )
    return (
      <Screen>
        <AppText>This photo is unavailable.</AppText>
        <Button
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </Screen>
    );
  return (
    <PhotoContent
      key={`${serverScope(session.user.id, session.access_token)}:${assignmentId}:${captureKind ?? 'auto'}`}
      userId={session.user.id}
      assignmentId={assignmentId}
      token={session.access_token}
      startCamera={capture === '1'}
      captureKind={captureKind}
    />
  );
}
export function PhotoContent({
  userId,
  assignmentId,
  token,
  startCamera = false,
  captureKind,
}: {
  userId: string;
  assignmentId: string;
  token: string;
  startCamera?: boolean;
  captureKind?: CaptureKind;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => photoGateway(userId, assignmentId, token, captureKind),
    [userId, assignmentId, token, captureKind],
  );
  const drafts = useMemo(
    () => ({
      load: () => loadDraft(userId, assignmentId),
      remove: (uri?: string) => removeDraft(userId, assignmentId, uri),
    }),
    [userId, assignmentId],
  );
  const [camera, setCamera] = useState(startCamera),
    [active, setActive] = useState(AppState.currentState === 'active'),
    [focused, setFocused] = useState(false);
  const [readyPreview, setReadyPreview] = useState<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const state = useAssignmentPhoto(gateway, drafts, focused && active);
  const alive = useRef(true),
    captureGeneration = useRef(0);
  const closeCamera = useCallback(() => {
    captureGeneration.current++;
    setCamera(false);
    setRetaking(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!retaking || !camera) return;
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        closeCamera();
        return true;
      });
      return () => back.remove();
    }, [retaking, camera, closeCamera]),
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      captureGeneration.current = captureGeneration.current + 1;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      let current = true;
      setFocused(true);
      const listener = AppState.addEventListener('change', (value) => {
        if (!current) return;
        setActive(value === 'active');
        if (value !== 'active') captureGeneration.current = captureGeneration.current + 1;
      });
      return () => {
        current = false;
        setFocused(false);
        captureGeneration.current = captureGeneration.current + 1;
        listener.remove();
      };
    }, []),
  );
  const submission = state.data?.submission;
  const completed = submission?.status === 'completed',
    deleting = submission?.status === 'deleting';
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (
      !focused ||
      !active ||
      !completed ||
      !submission ||
      !state.data ||
      opened.current === submission.id
    )
      return;
    opened.current = submission.id;
    openCompletedPost(
      { userId, token },
      state.data,
      state.acknowledgedCompletionId === submission.id,
    );
  }, [
    focused,
    active,
    completed,
    submission,
    state.data,
    state.acknowledgedCompletionId,
    userId,
    token,
  ]);
  const canCapture =
    !!state.data?.canCapture &&
    !completed &&
    !deleting &&
    !state.remoteUri &&
    (!state.photo || retaking);
  const library = useLibraryPhoto({
    gateway,
    userId,
    assignmentId,
    enabled: focused && !!state.data?.canCapture && !completed && !deleting && !state.remoteUri,
    eligibilityRevision: state.data,
    remove: drafts.remove,
    onPrepared: (prepared) => {
      state.acceptPhoto(prepared);
      setCamera(false);
      setRetaking(false);
    },
  });
  const chooseLibrary = library.available && !state.busy ? () => void library.choose() : undefined;
  if (completed)
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Opening photo" color={colors.brandPrimary} />
      </Screen>
    );
  return (
    <Screen
      footer={
        (state.remoteUri || state.photo) && !deleting && !(camera && canCapture) ? (
          <>
            <VisibilityChoice
              value={state.isPublic}
              disabled={state.busy || library.busy}
              onChange={state.setPublic}
            />
            <Button
              label="Add photo"
              loading={state.busy}
              disabled={
                readyPreview !== (state.remoteUri ?? state.photo?.uri) ||
                library.busy ||
                !state.data?.canCapture
              }
              onPress={() => void state.submit()}
            />
          </>
        ) : undefined
      }
    >
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          label="Back"
          onPress={() =>
            retaking && camera
              ? closeCamera()
              : router.canGoBack()
                ? router.back()
                : router.replace('/')
          }
        />
        <AppText variant="label">
          {completed
            ? 'Your photo'
            : camera && canCapture
              ? 'Take a photo'
              : state.data?.captureKind === 'historical'
                ? 'Past Word'
                : 'Today’s word'}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      {state.loading && !state.data ? (
        <ActivityIndicator accessibilityLabel="Loading photo challenge" />
      ) : null}
      {state.data && (
        <>
          {camera && canCapture && focused && active && !library.busy ? (
            <>
              <View style={styles.word}>
                <AppText variant="heading">{displayTerm(state.data.targetTerm)}</AppText>
                <AppText variant="caption">{displayTerm(state.data.referenceTerm)}</AppText>
              </View>
              <CameraCapture
                onCancel={closeCamera}
                onChooseLibrary={chooseLibrary}
                onCapture={async (captured) => {
                  const capture = ++captureGeneration.current;
                  const isCurrent = () => alive.current && capture === captureGeneration.current;
                  const prepared = await preparePhoto(captured, userId, assignmentId, isCurrent);
                  if (!isCurrent()) {
                    drafts.remove(prepared.uri);
                    return;
                  }
                  state.acceptPhoto(prepared);
                  setCamera(false);
                  setRetaking(false);
                }}
              />
            </>
          ) : (
            <>
              {camera && !active ? <AppText>Return to the app to use the camera.</AppText> : null}
              <PhotoPreview
                state={state}
                onPreviewReady={setReadyPreview}
                onChooseLibrary={chooseLibrary}
                choosing={library.busy}
                onTakePhoto={() => setCamera(true)}
                onRetake={() => {
                  setRetaking(true);
                  setCamera(true);
                }}
              />
            </>
          )}
        </>
      )}
      {library.busy && (
        <ActivityIndicator
          accessibilityLabel="Preparing library photo"
          color={colors.brandPrimary}
        />
      )}
      {(library.error || library.eligibilityError) && (
        <View style={styles.error}>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {library.error || library.eligibilityError}
          </AppText>
          {library.eligibilityError && (
            <Button
              label="Try photo library again"
              variant="secondary"
              disabled={library.busy || state.busy}
              onPress={library.retryEligibility}
            />
          )}
          {library.permissionDenied && Platform.OS !== 'web' && (
            <Button
              label="Open Settings"
              variant="secondary"
              onPress={() => {
                void Linking.openSettings().catch(() => {});
              }}
            />
          )}
        </View>
      )}
      {state.error ? (
        <View style={styles.error}>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {state.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            disabled={state.busy}
            onPress={() => void state.refresh()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerSpacer: { width: 44 },
  word: { alignItems: 'center', gap: 4 },
  error: { gap: 12 },
});
