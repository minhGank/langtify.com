import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { nativeBackFallback } from '@/components/ui/native-back';
import { useAuth } from '@/features/auth/auth-provider';
import { FeedPhoto } from '@/features/discover/feed-photo';
import { openPost } from '@/features/discover/open-post';
import { useDiscover } from '@/features/discover/use-discover';
import { SafetyUnavailable } from '@/features/safety/model';
import { discardPublicData } from '@/features/social/cache';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { FeedSettingsChanged } from '@/services/discover';
import { exploreGateway, type ExploreIdentity, type ExploreWord } from '@/services/explore';
import { displayTerm } from '@/utils/display-term';
import { conceptCache } from './cache';

export function ConceptScreen() {
  const { session, account, status } = useAuth();
  const { conceptId } = useLocalSearchParams<{ conceptId?: string | string[] }>();
  const identity = useMemo(
    () =>
      session && account?.learning
        ? {
            userId: session.user.id,
            token: session.access_token,
            targetLanguageId: account.learning.target_language_id,
            referenceLanguageId: account.learning.reference_language_id,
          }
        : null,
    [session, account],
  );
  if (status !== 'ready' || !identity) return null;
  const language =
    account?.languages.find((item) => item.id === identity.targetLanguageId)?.name ??
    'Your learning language';
  return (
    <ConceptFrame>
      {typeof conceptId === 'string' &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conceptId) ? (
        <ConceptContent
          key={`${serverScope(identity.userId, identity.token)}:${identity.targetLanguageId}:${identity.referenceLanguageId}:${conceptId}`}
          identity={identity}
          conceptId={conceptId.toLowerCase()}
          language={language}
        />
      ) : (
        <AppText style={styles.message}>This word is unavailable.</AppText>
      )}
    </ConceptFrame>
  );
}
function ConceptFrame({ children }: React.PropsWithChildren) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ headerLeft: nativeBackFallback() }} />
      {children}
    </SafeAreaView>
  );
}
function ConceptContent({
  identity,
  conceptId,
  language,
}: {
  identity: ExploreIdentity;
  conceptId: string;
  language: string;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => exploreGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      conceptCache.entry(
        `${serverScope(identity.userId, identity.token)}:concept:${identity.targetLanguageId}:${identity.referenceLanguageId}:${conceptId}`,
        ['explore', 'user-search'],
      ),
    [identity, conceptId],
  );
  const load = useCallback(
    async (signal: AbortSignal) => ({ item: await gateway.concept(conceptId, signal) }),
    [gateway, conceptId],
  );
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable) && !(cause instanceof FeedSettingsChanged))
        return false;
      discardPublicData(identity, entry);
      return true;
    },
    [identity, entry],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError });
  if (!query.data?.item)
    return (
      <View style={styles.message}>
        {query.loading ? (
          <ActivityIndicator accessibilityLabel="Loading word" color={colors.primary} />
        ) : (
          <AppText>
            {query.error ? 'This word could not be loaded.' : 'This word is unavailable.'}
          </AppText>
        )}
        {query.error && (
          <Button label="Retry word" variant="secondary" onPress={() => void query.refresh()} />
        )}
      </View>
    );
  return <ConceptExamples identity={identity} item={query.data.item} language={language} />;
}
function ConceptExamples({
  identity,
  item,
  language,
}: {
  identity: ExploreIdentity;
  item: ExploreWord;
  language: string;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => exploreGateway(identity).examples(item.conceptId),
    [identity, item.conceptId],
  );
  const scope = serverScope(identity.userId, identity.token);
  const state = useDiscover(
    gateway,
    `${scope}:concept-posts:${identity.targetLanguageId}:${item.conceptId}`,
    scope,
  );
  return (
    <FlatList
      data={state.items}
      keyExtractor={(post) => post.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      refreshing={state.loading && state.items.length > 0}
      onRefresh={() => void state.refresh()}
      ListHeaderComponent={
        <View style={styles.heading}>
          <AppText variant="caption">
            {language} · {item.cefrLevel}
          </AppText>
          <AppText variant="title">{displayTerm(item.targetTerm)}</AppText>
          <AppText variant="subtitle">{item.referenceTerm}</AppText>
          <AppText variant="heading" style={styles.examplesTitle}>
            In photos
          </AppText>
        </View>
      }
      renderItem={({ item: post }) => (
        <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
          <FeedPhoto
            key={`${post.id}:${state.photoRevision}`}
            word={displayTerm(post.targetTerm)}
            uri={state.photos[post.id]}
            reload={() => void state.renew()}
            open={() => openPost(identity, post)}
          />
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          {state.loading ? (
            <ActivityIndicator
              accessibilityLabel="Loading public examples"
              color={colors.primary}
            />
          ) : (
            <>
              <Ionicons name="images-outline" size={36} color={colors.muted} accessible={false} />
              <AppText variant="heading">
                {state.error ? 'Photos unavailable' : 'A fresh perspective awaits'}
              </AppText>
              <AppText variant="caption">
                {state.error
                  ? 'Try loading these photos again.'
                  : 'No public photos of this word yet.'}
              </AppText>
            </>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {state.error && (
            <Button
              label="Retry public examples"
              variant="secondary"
              onPress={() => void state.refresh()}
            />
          )}
          {state.hasMore && !state.loading && (
            <Button label="More photos" variant="secondary" onPress={() => void state.loadMore()} />
          )}
        </View>
      }
    />
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  message: { padding: 24, gap: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },
  heading: { gap: 6, paddingTop: 20, paddingBottom: 20 },
  examplesTitle: { marginTop: 24 },
  row: { gap: 12, marginBottom: 12 },
  tile: { flex: 1, maxWidth: '49%', borderRadius: 16, overflow: 'hidden' },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  footer: { paddingVertical: 16, gap: 12 },
});
