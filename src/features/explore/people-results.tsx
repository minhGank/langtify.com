import { useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { SafetyUnavailable, type SafetyIdentity, type SafetyPage } from '@/features/safety/model';
import { discardPublicData, searchCache, type SearchWindow } from '@/features/social/cache';
import { useConnectionAvatars } from '@/features/social/connections-avatars';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { socialGateway, type UserResult } from '@/services/social';
import { SearchEmpty, SearchFooter } from './search-results';
import { useSearchActive } from './use-search-active';

function first(page: SafetyPage<UserResult>): SearchWindow {
  const last = page.items.at(-1);
  return {
    ...page,
    fromStart: true,
    cursor: last ? { username: last.username, id: last.id } : null,
  };
}
export function PeopleResults({
  identity,
  query: prefix,
}: {
  identity: SafetyIdentity;
  query: string;
}) {
  const { colors } = useAppTheme();
  const active = useSearchActive();
  const list = useRef<FlatList<UserResult>>(null);
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      searchCache.entry(`${serverScope(identity.userId, identity.token)}:people:${prefix}`, [
        'user-search',
        'follows',
      ]),
    [identity, prefix],
  );
  const load = useCallback(
    async (signal: AbortSignal) => first(await gateway.search(prefix, null, signal)),
    [gateway, prefix],
  );
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable)) return false;
      discardPublicData(identity, entry);
      return true;
    },
    [identity, entry],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError });
  const avatars = useConnectionAvatars(
    identity,
    query.data?.items.flatMap((item) => (item.avatarId ? [item.avatarId] : [])) ?? [],
  );
  const more = () => {
    const snapshot = entry.getSnapshot(),
      saved = snapshot.data;
    if (!active.current || !saved?.hasMore || snapshot.loading) return;
    void entry.read(
      async (signal) => {
        const page = await gateway.search(prefix, saved.cursor ?? null, signal),
          last = page.items.at(-1);
        const merged = Array.from(
          new Map([...saved.items, ...page.items].map((item) => [item.id, item])).values(),
        );
        return {
          ...page,
          items: merged.slice(-40),
          fromStart: (saved.fromStart ?? true) && merged.length <= 40,
          cursor: last ? { username: last.username, id: last.id } : saved.cursor,
        };
      },
      { staleTime: Infinity, force: true, discardOnError },
    );
  };
  const refresh = () => {
    if (!active.current || entry.getSnapshot().loading || entry.getSnapshot().retired) return;
    const pending = query.refresh();
    const revision = entry.getRevision();
    void avatars.refresh();
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
  return (
    <FlatList
      ref={list}
      data={query.data?.items ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      refreshing={query.loading && !!query.data}
      onRefresh={refresh}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View @${item.username}`}
          onPress={() =>
            router.push({ pathname: '/public-profile', params: { profileId: item.id } })
          }
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: colors.border,
              backgroundColor: pressed ? colors.surfaceMuted : undefined,
            },
          ]}
        >
          <Avatar
            username={item.username}
            uri={item.avatarId ? avatars.photos[item.avatarId] : null}
          />
          <View style={styles.name}>
            <AppText variant="label">@{item.username}</AppText>
            <AppText variant="caption">
              {item.isSelf ? 'You' : item.isFollowing ? 'Following' : 'Not following'}
            </AppText>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
            accessible={false}
          />
        </Pressable>
      )}
      ListEmptyComponent={
        <SearchEmpty
          loading={query.loading}
          error={!!query.error}
          title="No people found"
          hint={query.error ? 'Pull down to try again.' : 'Try another username.'}
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
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, gap: 4 },
});
