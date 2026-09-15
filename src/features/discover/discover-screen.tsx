import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  feedGateway,
  type FeedCursor,
  type FeedIdentity,
  type FeedItem,
} from '@/services/discover';
import { useDiscover } from './use-discover';
import { SemanticRating } from '@/features/ratings/semantic-rating';
import type { RatingScore, RatingAction } from '@/features/ratings/rating';
import { CardActions } from '@/features/safety/card-actions';

export function DiscoverScreen() {
  const { status, session, account, reload } = useAuth();
  if (status !== 'ready' || !session || !account?.learning) return null;
  const targetLanguageId = account.learning.target_language_id;
  return (
    <DiscoverContent
      key={`${session.user.id}:${targetLanguageId}`}
      userId={session.user.id}
      token={session.access_token}
      targetLanguageId={targetLanguageId}
      reloadAccount={reload}
    />
  );
}
function DiscoverContent({
  userId,
  token,
  targetLanguageId,
  reloadAccount,
}: FeedIdentity & { reloadAccount: () => void }) {
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => ({
      rate: (id: string, score: RatingScore, signal?: AbortSignal) =>
        Promise.resolve().then(() =>
          feedGateway({ userId, token, targetLanguageId }).rate(id, score, signal),
        ),
      load: (cursor: FeedCursor | null, signal?: AbortSignal) =>
        Promise.resolve().then(() =>
          feedGateway({ userId, token, targetLanguageId }).load(cursor, signal),
        ),
      previews: (ids: string[], signal?: AbortSignal) =>
        Promise.resolve().then(() =>
          feedGateway({ userId, token, targetLanguageId }).previews(ids, signal),
        ),
    }),
    [userId, token, targetLanguageId],
  );
  const state = useDiscover(gateway);
  const [safetyItem, setSafetyItem] = useState<FeedItem | null>(null);
  const safetyIdentity = useMemo(() => ({ userId, token }), [userId, token]);
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
        ListHeaderComponent={
          <View style={styles.gap}>
            <AppText variant="title">Discover</AppText>
            <AppText>Vocabulary through the eyes of other learners.</AppText>
            {state.loading && <ActivityIndicator accessibilityLabel="Loading Discover" />}
            {state.error && (
              <>
                <AppText accessibilityRole="alert">{state.error}</AppText>
                <Button label="Retry feed" onPress={() => void state.refresh()} />
                {state.settingsChanged && (
                  <Button label="Reload account" onPress={() => void reloadAccount()} />
                )}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <FeedCard
            key={`${item.id}:${state.photoRevision}`}
            item={item}
            ratingAction={state.ratingAction?.id === item.id ? state.ratingAction : null}
            ratingDisabled={state.ratingAction?.status === 'saving'}
            rate={(score) => void state.rate(item.id, score)}
            actions={() => setSafetyItem(item)}
            uri={state.photos[item.id]}
            reload={() => void state.renew()}
          />
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <AppText>
              {state.hasMore
                ? 'No photos remain in this part of the feed. Load more or refresh.'
                : 'No public photos to show here. Refresh the feed to check again.'}
            </AppText>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.gap}>
            {state.hasMore && (
              <Button
                label="Load more"
                loading={state.loading}
                onPress={() => void state.loadMore()}
              />
            )}
            <Button label="Refresh feed" onPress={() => void state.refresh()} />
          </View>
        }
      />
      {safetyItem && (
        <CardActions
          key={`${userId}:${token}`}
          identity={safetyIdentity}
          item={safetyItem}
          close={() => setSafetyItem(null)}
          blocked={() => {
            setSafetyItem(null);
            void state.refresh();
          }}
        />
      )}
    </SafeAreaView>
  );
}
function FeedCard({
  item,
  uri,
  reload,
  rate,
  ratingAction,
  ratingDisabled,
  actions,
}: {
  item: FeedItem;
  uri?: string;
  reload: () => void;
  rate: (score: RatingScore) => void;
  ratingAction: RatingAction | null;
  ratingDisabled: boolean;
  actions: () => void;
}) {
  const { colors } = useAppTheme();
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {uri && !failed ? (
        <>
          <Image
            source={{ uri, cache: 'reload' }}
            style={styles.photo}
            accessibilityLabel={`Photo of ${item.targetTerm}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {!loaded && <ActivityIndicator accessibilityLabel="Loading feed photo" />}
        </>
      ) : (
        <>
          <AppText>Photo unavailable or expired.</AppText>
          <Button label="Reload photos" onPress={reload} />
        </>
      )}
      <AppText variant="title">{item.targetTerm}</AppText>
      <AppText>
        {item.referenceTerm} · {item.cefrLevel}
      </AppText>
      <AppText>@{item.username}</AppText>
      {item.canRate && (
        <Button
          label={`More actions for @${item.username}`}
          disabled={ratingDisabled}
          onPress={actions}
        />
      )}
      <AppText>{new Date(item.submittedAt).toLocaleString()}</AppText>
      <SemanticRating
        word={item.targetTerm}
        summary={item}
        action={ratingAction}
        disabled={ratingDisabled}
        onRate={rate}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' },
  gap: { gap: 12 },
  card: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 16 },
  photo: { width: '100%', height: 260, borderRadius: 10 },
});
