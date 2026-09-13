import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, AppState } from 'react-native';
import { SubmissionXpFeedback } from '@/features/progress/submission-xp-feedback';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { photoGateway } from '@/services/submissions';
import { CameraCapture } from './camera-capture';
import { PhotoPreview } from './photo-preview';
import { loadDraft, preparePhoto, removeDraft } from './photo-files';
import { useAssignmentPhoto } from './use-assignment-photo';

export function PhotoScreen() {
  const { session, status } = useAuth();
  const { assignmentId } = useLocalSearchParams<{ assignmentId?: string | string[] }>();
  if (
    status !== 'ready' ||
    !session ||
    typeof assignmentId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(assignmentId)
  )
    return (
      <Screen>
        <AppText>This photo is unavailable.</AppText>
        <Button label="Back to Today" onPress={() => router.replace('/')} />
      </Screen>
    );
  return (
    <PhotoContent
      key={`${session.user.id}:${assignmentId}`}
      userId={session.user.id}
      assignmentId={assignmentId}
      token={session.access_token}
    />
  );
}
export function PhotoContent({
  userId,
  assignmentId,
  token,
}: {
  userId: string;
  assignmentId: string;
  token: string;
}) {
  const gateway = useMemo(
    () => photoGateway(userId, assignmentId, token),
    [userId, assignmentId, token],
  );
  const drafts = useMemo(
    () => ({
      load: () => loadDraft(userId, assignmentId),
      remove: (uri?: string) => removeDraft(userId, assignmentId, uri),
    }),
    [userId, assignmentId],
  );
  const state = useAssignmentPhoto(gateway, drafts);
  const { refresh } = state;
  const [camera, setCamera] = useState(false),
    [active, setActive] = useState(AppState.currentState === 'active'),
    [focused, setFocused] = useState(false);
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
      setFocused(true);
      const listener = AppState.addEventListener('change', (value) => {
        setActive(value === 'active');
        if (value !== 'active') captureGeneration.current = captureGeneration.current + 1;
        if (value === 'active') void refresh();
      });
      // Signed preview URLs are short lived. Refresh while visible, never persist them.
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refresh();
      }, 45000);
      return () => {
        setFocused(false);
        captureGeneration.current = captureGeneration.current + 1;
        listener.remove();
        clearInterval(timer);
      };
    }, [refresh]),
  );
  const submission = state.data?.submission;
  const completed = submission?.status === 'completed',
    deleting = submission?.status === 'deleting';
  const canCapture = !completed && !deleting && !state.remoteUri;
  return (
    <Screen>
      <AppText variant="title">{completed ? 'Your photo' : 'Photo challenge'}</AppText>
      <Button label="Back to Today" onPress={() => router.replace('/')} />
      {state.loading && !state.data ? (
        <ActivityIndicator accessibilityLabel="Loading photo challenge" />
      ) : null}
      {state.data && (
        <>
          <AppText accessibilityRole="header">{state.data.targetTerm}</AppText>
          <AppText>{state.data.referenceTerm}</AppText>
          <AppText>
            Challenge: {state.data.localDate} · {state.data.timezone}
          </AppText>
          {camera && canCapture && focused && active ? (
            <CameraCapture
              onCancel={() => setCamera(false)}
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
          ) : (
            <>
              {camera && !active ? <AppText>Return to the app to use the camera.</AppText> : null}
              <PhotoPreview
                state={state}
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
      {completed && submission && (
        <SubmissionXpFeedback
          key={`${userId}:${submission.id}`}
          userId={userId}
          accessToken={token}
          submissionId={submission.id}
        />
      )}
      {state.error ? <AppText accessibilityRole="alert">{state.error}</AppText> : null}
      <Button label="Refresh photo" disabled={state.busy} onPress={() => void state.refresh()} />
    </Screen>
  );
}
