import { useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { QuickRating } from '@/features/ratings/quick-rating';
import type { RatingAction, RatingScore } from '@/features/ratings/rating';
import { CardActions } from '@/features/safety/card-actions';
import type { FeedItem } from '@/services/discover';
import { FeedPhoto } from './feed-photo';
import { Comments } from '@/features/social/comments';
import { PublicProfileSheet } from '@/features/social/public-profile';
import type { PublicProfileTarget } from '@/services/social';
import { PostShareAction } from './post-share-action';
import { useAvatarRows } from '@/features/social/connections-avatars';
import { PostAuthor } from './post-author';
import { PostLayout } from './post-layout';
import { displayTerm } from '@/utils/display-term';

export function PostDetail({
  item,
  language,
  uri,
  photoRevision,
  photoLoading = false,
  status,
  userId,
  token,
  reload,
  rate,
  ratingAction,
  ratingDisabled,
  blocked,
  openAuthor,
  owner,
  socialAvailable = true,
}: {
  item: FeedItem;
  language: string;
  uri?: string;
  photoRevision: number;
  photoLoading?: boolean;
  status?: React.ReactNode;
  userId: string;
  token: string;
  reload: () => void;
  rate: (score: RatingScore) => void;
  ratingAction: RatingAction | null;
  ratingDisabled: boolean;
  blocked: () => void;
  openAuthor?: () => void;
  owner?: {
    visibility: string;
    controls: (share?: React.ReactNode) => React.ReactNode;
    notice?: React.ReactNode;
    message?: React.ReactNode;
  };
  socialAvailable?: boolean;
}) {
  const { colors } = useAppTheme();
  const [actions, setActions] = useState(false);
  const [profileTarget, setProfileTarget] = useState<PublicProfileTarget>();
  const identity = useMemo(() => ({ userId, token }), [userId, token]);
  const avatars = useAvatarRows(
    identity,
    owner || socialAvailable
      ? [{ avatarId: item.avatarId, isSelf: Boolean(owner) || !item.canRate }]
      : [],
  );
  const share = socialAvailable ? (
    <PostShareAction key={`${userId}:${token}:${item.id}`} item={item} />
  ) : undefined;
  const content = (
    <>
      <View>
        <FeedPhoto
          key={`${item.id}:${photoRevision}`}
          uri={uri}
          pending={photoLoading}
          word={displayTerm(item.targetTerm)}
          reload={reload}
          detail
        />
      </View>
      <View style={styles.body}>
        {status}
        {owner?.message}
        <View style={styles.wordBlock}>
          <AppText variant="caption" style={{ color: colors.textSecondary }}>
            {language} · {item.cefrLevel}
            {owner ? ` · ${owner.visibility === 'public' ? 'Public' : 'Private'}` : ''}
          </AppText>
          <AppText variant="title">{displayTerm(item.targetTerm)}</AppText>
          <AppText variant="subtitle" style={{ color: colors.textSecondary }}>
            {displayTerm(item.referenceTerm)}
          </AppText>
        </View>
        <PostAuthor
          username={item.username}
          uri={
            owner || socialAvailable
              ? avatars.uri({ avatarId: item.avatarId, isSelf: Boolean(owner) || !item.canRate })
              : undefined
          }
          date={item.submittedAt}
          onPress={openAuthor ?? (() => setProfileTarget({ submissionId: item.id }))}
        />
        {socialAvailable && (
          <View style={[styles.rating, { borderColor: colors.border }]}>
            <QuickRating
              word={displayTerm(item.targetTerm)}
              summary={item}
              action={ratingAction}
              disabled={ratingDisabled}
              onRate={rate}
            />
          </View>
        )}
      </View>
    </>
  );
  return (
    <SafeAreaView
      edges={socialAvailable ? ['left', 'right'] : ['left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: colors.surface }]}
    >
      <Stack.Screen
        options={{
          headerRight: () =>
            owner ? (
              owner.controls(share)
            ) : socialAvailable ? (
              <IconButton
                name="ellipsis-horizontal"
                label={`More actions for @${item.username}`}
                disabled={ratingDisabled}
                onPress={() => setActions(true)}
              />
            ) : null,
        }}
      />
      {socialAvailable ? (
        <Comments
          key={`${userId}:${token}:${item.id}`}
          identity={identity}
          submissionId={item.id}
          openProfile={(profileId) => setProfileTarget({ profileId })}
          unavailable={blocked}
          render={(thread, composer) => (
            <PostLayout composer={composer} hidden={actions}>
              {content}
              <View style={styles.thread}>{thread}</View>
            </PostLayout>
          )}
        />
      ) : (
        <PostLayout>{content}</PostLayout>
      )}
      {owner?.notice && (
        <View pointerEvents="none" style={styles.notice}>
          {owner.notice}
        </View>
      )}
      {profileTarget && (
        <PublicProfileSheet
          identity={identity}
          target={profileTarget}
          close={() => setProfileTarget(undefined)}
        />
      )}
      {actions && socialAvailable && (
        <CardActions
          key={`${userId}:${token}`}
          identity={identity}
          item={item}
          close={() => setActions(false)}
          blocked={blocked}
          share={share}
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  notice: {
    position: 'absolute',
    top: 12,
    left: 20,
    right: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 20, paddingTop: 22, gap: 18 },
  wordBlock: { gap: 5 },
  rating: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
  thread: { paddingHorizontal: 20, paddingTop: 22 },
});
