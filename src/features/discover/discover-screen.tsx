import { TabHeading } from '@/components/ui/tab-heading';
import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { serverScope } from '@/lib/server-cache';
import { PublicProfileSheet } from '@/features/social/public-profile';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { feedGateway, type FeedCursor, type FeedIdentity } from '@/services/discover';
import type { RatingScore } from '@/features/ratings/rating';
import { useDiscover } from './use-discover';
import { FeedCard } from './feed-card';
import { openPost } from './open-post';

export function DiscoverScreen() {
  const { status, session, account, reload } = useAuth();
  if (status !== 'ready' || !session || !account?.learning) return null;
  const targetLanguageId = account.learning.target_language_id;
  const language =
    account.languages.find((item) => item.id === targetLanguageId)?.name ??
    'Your learning language';
  return (
    <DiscoverContent
      key={`${session.user.id}:${targetLanguageId}`}
      userId={session.user.id}
      token={session.access_token}
      targetLanguageId={targetLanguageId}
      language={language}
      reloadAccount={reload}
    />
  );
}
function DiscoverContent({
  userId,
  token,
  targetLanguageId,
  language,
  reloadAccount,
}: FeedIdentity & { language: string; reloadAccount: () => void }) {
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => ({
      cachedPreviews: (ids: string[]) =>
        feedGateway({ userId, token, targetLanguageId }).cachedPreviews?.(ids) ?? {},
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
  const state = useDiscover(
    gateway,
    `${serverScope(userId, token)}:discover:${targetLanguageId}`,
    serverScope(userId, token),
  );
  const identity = useMemo(() => ({ userId, token }), [userId, token]);
  const [authorId, setAuthorId] = useState<string | null>(null);
  const authorTarget = useMemo(
    () => (authorId ? { submissionId: authorId } : undefined),
    [authorId],
  );
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
        refreshing={state.loading && state.items.length === 0}
        onRefresh={() => void state.refresh()}
        onEndReached={() => {
          if (!state.loading && !state.error && state.hasMore) void state.loadMore();
        }}
        onEndReachedThreshold={0.3}
        initialNumToRender={4}
        windowSize={5}
        ListHeaderComponent={
          <View style={styles.header}>
            <TabHeading title="Discover" />
            <AppText variant="caption">{language} · Newest first</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search words and people"
              onPress={() => router.push('/explore')}
              style={({ pressed }) => [
                styles.search,
                { backgroundColor: pressed ? colors.brandSoft : colors.surfaceMuted },
              ]}
            >
              <View style={[styles.discoveryIcon, { backgroundColor: colors.accentEnergy }]}>
                <Ionicons
                  name="search-outline"
                  size={20}
                  color={colors.textOnAccent}
                  accessible={false}
                />
              </View>
              <AppText style={{ color: colors.textSecondary }}>Words and people</AppText>
            </Pressable>
            {state.error && (
              <View style={[styles.error, { backgroundColor: colors.errorSoft }]}>
                <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                  {state.error}
                </AppText>
                <Button
                  label="Retry feed"
                  variant="secondary"
                  onPress={() => void state.refresh()}
                />
                {state.settingsChanged && (
                  <Button
                    label="Reload account"
                    variant="secondary"
                    onPress={() => void reloadAccount()}
                  />
                )}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            language={language}
            uri={state.photos[item.id]}
            photoRevision={state.photoRevision}
            reload={() => void state.renew()}
            open={() => openPost({ userId, token, targetLanguageId }, item)}
            author={() => setAuthorId(item.id)}
            ratingAction={state.ratingAction?.id === item.id ? state.ratingAction : null}
            ratingDisabled={state.ratingAction?.status === 'saving'}
            rate={(score) => void state.rate(item.id, score)}
          />
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <View style={styles.empty}>
              <Ionicons name="images-outline" size={44} color={colors.textSecondary} />
              <AppText variant="heading">
                {state.hasMore ? 'Photos no longer available' : 'No public photos yet'}
              </AppText>
              <AppText style={styles.center}>
                {state.hasMore
                  ? 'These photos are no longer available. Keep browsing to see more.'
                  : 'Photos shared by learners will appear here.'}
              </AppText>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {state.loading && (
              <ActivityIndicator
                accessibilityLabel="Loading Discover"
                color={colors.brandPrimary}
              />
            )}
            {state.hasMore && !state.loading && (
              <Button label="Load more" variant="ghost" onPress={() => void state.loadMore()} />
            )}
            {!state.hasMore && state.items.length > 0 && !state.loading && (
              <AppText variant="caption">You’re all caught up</AppText>
            )}
          </View>
        }
      />
      {authorTarget && (
        <PublicProfileSheet
          key={`${userId}:${token}:${authorId}`}
          identity={identity}
          target={authorTarget}
          close={() => setAuthorId(null)}
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  discoveryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 24,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  header: { paddingHorizontal: 6, paddingTop: 20, gap: 6 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 18,
    marginTop: 12,
  },
  error: { padding: 16, borderRadius: 16, gap: 12, marginTop: 16 },
  empty: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24, gap: 12 },
  center: { textAlign: 'center' },
  footer: { alignItems: 'center', paddingVertical: 12, gap: 12 },
});
