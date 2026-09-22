import { useEffect, useMemo, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SemanticRating } from '@/features/ratings/semantic-rating';
import type { RatingAction, RatingScore } from '@/features/ratings/rating';
import { CardActions } from '@/features/safety/card-actions';
import type { FeedItem } from '@/services/discover';
import { FeedPhoto } from './feed-photo';
import { Comments } from '@/features/social/comments';
import { PublicProfileSheet } from '@/features/social/public-profile';
import type { PublicProfileTarget } from '@/services/social';
import { sharePost } from './share-post';
import { displayTerm } from '@/utils/display-term';

export function PostDetail({
  item,
  language,
  uri,
  photoRevision,
  userId,
  token,
  reload,
  rate,
  ratingAction,
  ratingDisabled,
  blocked,
  openAuthor,
}: {
  item: FeedItem;
  language: string;
  uri?: string;
  photoRevision: number;
  userId: string;
  token: string;
  reload: () => void;
  rate: (score: RatingScore) => void;
  ratingAction: RatingAction | null;
  ratingDisabled: boolean;
  blocked: () => void;
  openAuthor?: () => void;
}) {
  const { colors } = useAppTheme();
  const [actions, setActions] = useState(false);
  const [profileTarget, setProfileTarget] = useState<PublicProfileTarget>();
  const [shareError, setShareError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = useMemo(() => ({ userId, token }), [userId, token]);
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerRight: () =>
            item.canRate ? (
              <IconButton
                name="ellipsis-horizontal"
                label={`More actions for @${item.username}`}
                disabled={ratingDisabled}
                onPress={() => setActions(true)}
              />
            ) : null,
        }}
      />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentContainerStyle={styles.content}
        accessibilityElementsHidden={actions}
        importantForAccessibility={actions ? 'no-hide-descendants' : 'auto'}
      >
        <FeedPhoto
          key={`${item.id}:${photoRevision}`}
          uri={uri}
          word={displayTerm(item.targetTerm)}
          reload={reload}
          detail
        />
        <View style={styles.body}>
          <View style={styles.wordBlock}>
            <AppText variant="caption" style={{ color: colors.primary }}>
              {language} · {item.cefrLevel}
            </AppText>
            <AppText variant="title">{displayTerm(item.targetTerm)}</AppText>
            <AppText variant="subtitle" style={{ color: colors.muted }}>
              {displayTerm(item.referenceTerm)}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View @${item.username}`}
              onPress={openAuthor ?? (() => setProfileTarget({ submissionId: item.id }))}
              style={styles.author}
            >
              <AppText variant="caption">Photo by @{item.username}</AppText>
            </Pressable>
          </View>
          <View style={[styles.rating, { borderColor: colors.border }]}>
            <SemanticRating
              word={displayTerm(item.targetTerm)}
              summary={item}
              action={ratingAction}
              disabled={ratingDisabled}
              onRate={rate}
            />
          </View>
          <Comments
            identity={identity}
            submissionId={item.id}
            openProfile={(profileId) => setProfileTarget({ profileId })}
            unavailable={blocked}
          />
          <Button
            label="Share"
            variant="ghost"
            onPress={() => {
              setShareError(false);
              void sharePost(item).catch(() => {
                if (mounted.current) setShareError(true);
              });
            }}
          />
          {shareError && (
            <AppText accessibilityRole="alert">Sharing is unavailable. Please try again.</AppText>
          )}
          <AppText variant="caption">
            Shared{' '}
            {new Date(item.submittedAt).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </AppText>
        </View>
      </ScrollView>
      {profileTarget && (
        <PublicProfileSheet
          identity={identity}
          target={profileTarget}
          close={() => setProfileTarget(undefined)}
        />
      )}
      {actions && item.canRate && (
        <CardActions
          key={`${userId}:${token}`}
          identity={identity}
          item={item}
          close={() => setActions(false)}
          blocked={blocked}
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 28 },
  body: { padding: 22, gap: 24 },
  wordBlock: { gap: 6 },
  author: { minHeight: 44, justifyContent: 'center' },
  rating: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
});
