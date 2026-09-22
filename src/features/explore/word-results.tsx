import { useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { SafetyUnavailable } from '@/features/safety/model';
import { discardPublicData } from '@/features/social/cache';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { FeedSettingsChanged } from '@/services/discover';
import {
  exploreGateway,
  type ExploreIdentity,
  type ExploreWord,
  type WordPage,
} from '@/services/explore';
import { displayTerm } from '@/utils/display-term';
import { wordsCache, type WordWindow } from './cache';
import { SearchEmpty, SearchFooter } from './search-results';
import { useSearchActive } from './use-search-active';

function first(page: WordPage): WordWindow {
  const last = page.items.at(-1);
  return {
    ...page,
    fromStart: true,
    cursor: last ? { term: last.targetTerm, id: last.conceptId } : null,
  };
}
export function WordResults({
  identity,
  query: prefix,
}: {
  identity: ExploreIdentity;
  query: string;
}) {
  const { colors } = useAppTheme();
  const active = useSearchActive();
  const list = useRef<FlatList<ExploreWord>>(null);
  const gateway = useMemo(() => exploreGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      wordsCache.entry(
        `${serverScope(identity.userId, identity.token)}:words:${identity.targetLanguageId}:${identity.referenceLanguageId}:${prefix}`,
        ['explore', 'user-search'],
      ),
    [identity, prefix],
  );
  const load = useCallback(
    async (signal: AbortSignal) => first(await gateway.words(prefix, null, signal)),
    [gateway, prefix],
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
  const refresh = () => {
    if (!active.current || entry.getSnapshot().loading || entry.getSnapshot().retired) return;
    const pending = query.refresh();
    const revision = entry.getRevision();
    void pending.then(() => {
      const saved = entry.getSnapshot();
      if (
        active.current &&
        entry.getRevision() === revision &&
        !saved.error &&
        !saved.loading &&
        !saved.retired &&
        saved.data?.fromStart
      )
        list.current?.scrollToOffset({ offset: 0, animated: false });
    });
  };
  const more = () => {
    const snapshot = entry.getSnapshot(),
      saved = snapshot.data;
    if (!active.current || !saved?.hasMore || snapshot.loading) return;
    void entry.read(
      async (signal) => {
        const page = await gateway.words(prefix, saved.cursor, signal),
          last = page.items.at(-1);
        const merged = Array.from(
          new Map([...saved.items, ...page.items].map((item) => [item.conceptId, item])).values(),
        );
        return {
          ...page,
          items: merged.slice(-40),
          fromStart: saved.fromStart && merged.length <= 40,
          cursor: last ? { term: last.targetTerm, id: last.conceptId } : saved.cursor,
        };
      },
      { staleTime: Infinity, force: true, discardOnError },
    );
  };
  return (
    <FlatList
      ref={list}
      data={query.data?.items ?? []}
      keyExtractor={(item) => item.conceptId}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      refreshing={query.loading && !!query.data}
      onRefresh={refresh}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Explore ${displayTerm(item.targetTerm)}`}
          onPress={() =>
            router.push({ pathname: '/explore-concept', params: { conceptId: item.conceptId } })
          }
          style={({ pressed }) => [
            styles.row,
            { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={styles.term}>
            <AppText variant="heading">{displayTerm(item.targetTerm)}</AppText>
            <AppText variant="subtitle">{item.referenceTerm}</AppText>
          </View>
          <View style={[styles.level, { backgroundColor: colors.surfaceMuted }]}>
            <AppText variant="label">{item.cefrLevel}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} accessible={false} />
        </Pressable>
      )}
      ListEmptyComponent={
        <SearchEmpty
          loading={query.loading}
          error={!!query.error}
          title="No matching words"
          hint={query.error ? 'Pull down to try again.' : 'Try the beginning of another word.'}
        />
      }
      ListFooterComponent={
        <SearchFooter
          loading={query.loading}
          error={query.error}
          hasMore={!!query.data?.hasMore}
          fromStart={query.data?.fromStart ?? true}
          more={more}
          refresh={refresh}
        />
      }
    />
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  term: { flex: 1, gap: 4 },
  level: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
});
