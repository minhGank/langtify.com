import { displayTerm } from '@/utils/display-term';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { SubmissionXpFeedback } from '@/features/progress/submission-xp-feedback';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { IconButton } from '@/components/ui/icon-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { photoGateway, type CaptureKind } from '@/services/submissions';
import { CameraCapture } from './camera-capture';
import { PhotoPreview } from './photo-preview';
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
  const state = useAssignmentPhoto(gateway, drafts, focused && active);
  const alive = useRef(true),
    captureGeneration = useRef(0);
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
  const canCapture =
    !!state.data?.canCapture && !completed && !deleting && !state.remoteUri && !state.photo;
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
    },
  });
  const chooseLibrary = library.available && !state.busy ? () => void library.choose() : undefined;
  return (
    <Screen>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <AppText variant="label">
          {completed
            ? 'Your photo'
            : camera && canCapture
              ? 'Take a photo'
              : state.data?.captureKind === 'historical'
                ? 'Past Word'
                : 'Photo challenge'}
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
                onCancel={() => setCamera(false)}
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
                }}
              />
            </>
          ) : (
            <>
              {camera && !active ? <AppText>Return to the app to use the camera.</AppText> : null}
              <PhotoPreview
                state={state}
                onChooseLibrary={chooseLibrary}
                choosing={library.busy}
                onTakePhoto={() => setCamera(true)}
                onRetake={() => {
                  state.retake();
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
              label="Retry photo library"
              variant="secondary"
              disabled={library.busy || state.busy}
              onPress={library.retryEligibility}
            />
          )}
          {library.permissionDenied && Platform.OS !== 'web' && (
            <Button
              label="Open photo settings"
              variant="secondary"
              onPress={() => {
                void Linking.openSettings().catch(() => {});
              }}
            />
          )}
        </View>
      )}
      {completed && submission && (
        <SubmissionXpFeedback
          key={`${userId}:${submission.id}`}
          userId={userId}
          accessToken={token}
          submissionId={submission.id}
          historical={submission.capture_kind === 'historical'}
        />
      )}
      {state.error ? (
        <View style={styles.error}>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {state.error}
          </AppText>
          <Button
            label="Retry photo"
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
