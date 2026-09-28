import { useCallback, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { PhotoOptions } from '@/features/photos/photo-options';
import { loadDraft, removeDraft } from '@/features/photos/photo-files';
import { useAssignmentPhoto } from '@/features/photos/use-assignment-photo';
import { PhotoAddedNotice } from '@/features/progress/photo-added-notice';
import { useServerQuery } from '@/hooks/use-server-query';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { photoGateway } from '@/services/submissions';
import { feedGateway, type FeedIdentity, type FeedItem } from '@/services/discover';
import { PostLoading, PostRefreshState } from './post-loading';
import { PostDetail } from './post-detail';

const social = createServerCache<{ item: FeedItem | null }>({ maxEntries: 12 });
const discardOnError = () => true;
export function OwnerPost({
  identity,
  id,
  assignmentId,
}: {
  identity: FeedIdentity;
  id: string;
  assignmentId: string;
}) {
  const { account } = useAuth();
  const { userId, token } = identity;
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
  const [active, setActive] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setActive(AppState.currentState === 'active');
      const listener = AppState.addEventListener('change', (next) => setActive(next === 'active'));
      return () => {
        setActive(false);
        listener.remove();
      };
    }, []),
  );
  const state = useAssignmentPhoto(gateway, drafts, active);
  const saved = state.data?.submission;
  const completed = saved?.id === id && saved.status === 'completed';
  const publicPhoto = completed && saved.visibility === 'public';
  const entry = useMemo(
    () =>
      social.entry(
        `${serverScope(userId, token)}:owner-social:${identity.targetLanguageId}:${id}:${publicPhoto}`,
        ['discover'],
      ),
    [userId, token, identity.targetLanguageId, id, publicPhoto],
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!publicPhoto) return { item: null };
      const page = await feedGateway(identity, { submissionId: id }).load(null, signal);
      const item = page.items.find((row) => row.id === id) ?? null;
      if (item?.canRate) throw new Error('Photo ownership changed.');
      return { item };
    },
    [identity, id, publicPhoto],
  );
  const publicState = useServerQuery(entry, load, { staleTime: Infinity, discardOnError });
  const eligible = publicPhoto && !publicState.error ? publicState.data?.item : null;
  if ((!completed || !state.data) && (state.loading || state.busy || !active))
    return <PostLoading />;
  if (!completed || !state.data)
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        {state.loading || state.busy ? (
          <PostLoading />
        ) : (
          <AppText variant="heading">Photo unavailable</AppText>
        )}
        {saved?.id === id && saved.status === 'deleting' ? (
          <Button
            label="Finish deleting"
            loading={state.busy}
            onPress={() => void state.deletePhoto()}
          />
        ) : state.error ? (
          <Button
            label="Try again"
            variant="secondary"
            disabled={state.busy}
            onPress={() => void state.refresh()}
          />
        ) : null}
      </View>
    );
  const item: FeedItem = eligible ?? {
    id,
    targetTerm: saved.target_term,
    referenceTerm: saved.reference_term,
    cefrLevel: state.data.cefrLevel,
    avatarId: null,
    username: account?.profile?.username ?? '',
    submittedAt: saved.submitted_at ?? saved.created_at,
    canRate: false,
    viewerRating: null,
    averageRating: null,
    ratingCount: 0,
  };
  return (
    <PostDetail
      item={item}
      language={
        account?.languages.find((language) => language.id === state.data?.targetLanguageId)?.name ??
        'Photo'
      }
      uri={state.remoteUri ?? undefined}
      photoRevision={photoRevision}
      photoLoading={state.loading || state.busy}
      userId={userId}
      token={token}
      reload={() => {
        setPhotoRevision((value) => value + 1);
        void state.refresh();
      }}
      rate={() => {}}
      ratingAction={null}
      ratingDisabled
      blocked={() => void publicState.refresh()}
      openAuthor={() => router.push('/profile')}
      socialAvailable={Boolean(eligible)}
      owner={{
        visibility: saved.visibility,
        controls: (share) => <PhotoOptions state={state} share={share} />,
        notice: <PhotoAddedNotice userId={userId} token={token} submissionId={id} />,
        message: (
          <PostRefreshState
            pending={state.loading || publicState.loading}
            error={state.error || (publicState.error ? 'We couldn’t load public activity.' : null)}
            refresh={() => {
              void state.refresh();
              void publicState.refresh();
            }}
          />
        ),
      }}
    />
  );
}
