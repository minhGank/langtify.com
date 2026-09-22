import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-provider';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import {
  connectionsGateway,
  type Connection,
  type ConnectionKind,
  type ConnectionsPage,
} from '@/services/connections';
import { socialGateway } from '@/services/social';
import {
  connectionsCache,
  discardPublicData,
  followChanged,
  type ConnectionsWindow,
} from './cache';
import { followWithRecovery } from './follow-operation';
import { useConnectionAvatars } from './connections-avatars';

export function ConnectionsScreen() {
  const { session, status } = useAuth();
  const { profileId, kind } = useLocalSearchParams<{
    profileId?: string | string[];
    kind?: string | string[];
  }>();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  if (!identity || status !== 'ready') return null;
  const validId =
    typeof profileId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profileId);
  return validId && (kind === 'followers' || kind === 'following') ? (
    <ConnectionsContent
      key={`${serverScope(identity.userId, identity.token)}:${profileId}:${kind}`}
      identity={identity}
      profileId={profileId.toLowerCase()}
      kind={kind}
    />
  ) : (
    <ConnectionsFrame title="Connections">
      <AppText>This list is unavailable.</AppText>
    </ConnectionsFrame>
  );
}
function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}
function ConnectionsFrame({ title, children }: React.PropsWithChildren<{ title: string }>) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton name="chevron-back" label="Back" onPress={close} />
        <AppText variant="heading">{title}</AppText>
      </View>
      {children}
    </SafeAreaView>
  );
}
function pageWindow(page: ConnectionsPage, kind: ConnectionKind): ConnectionsWindow {
  const last = page.items.at(-1);
  return {
    ...page,
    kind,
    fromLatest: true,
    cursor: last ? { time: last.followedAt, id: last.id } : null,
  };
}
export function ConnectionsContent({
  identity,
  profileId,
  kind,
}: {
  identity: SafetyIdentity;
  profileId: string;
  kind: ConnectionKind;
}) {
  const { colors } = useAppTheme();
  const active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = AppState.currentState === 'active';
      const listener = AppState.addEventListener('change', (state) => {
        active.current = state === 'active';
      });
      return () => {
        active.current = false;
        listener.remove();
      };
    }, []),
  );
  const scope = serverScope(identity.userId, identity.token);
  const list = useRef<FlatList<Connection>>(null);
  const gateway = useMemo(
    () => connectionsGateway(identity, profileId, kind),
    [identity, profileId, kind],
  );
  const social = useMemo(() => socialGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      connectionsCache.entry(`${scope}:connections:${profileId}:${kind}`, [
        'connections',
        'follows',
      ]),
    [scope, profileId, kind],
  );
  const load = useCallback(
    async (signal: AbortSignal) => pageWindow(await gateway.load(null, signal), kind),
    [gateway, kind],
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
  const task = useSafetyTask(
    () => {},
    undefined,
    () => discardPublicData(identity),
  );
  const avatars = useConnectionAvatars(
    identity,
    query.data?.items.flatMap((item) => (item.avatarId ? [item.avatarId] : [])) ?? [],
  );
  const title = kind === 'followers' ? 'Followers' : 'Following';
  const more = () => {
    const previous = entry.getSnapshot();
    if (!active.current || !previous.data?.hasMore || previous.loading || task.busy) return;
    const saved = previous.data;
    void entry.read(
      async (signal) => {
        const page = await gateway.load(saved.cursor, signal);
        const seen = new Set(saved.items.map((item) => item.id));
        const merged = [...saved.items, ...page.items.filter((item) => !seen.has(item.id))];
        const last = page.items.at(-1);
        return {
          ...page,
          kind,
          items: merged.slice(-40),
          fromLatest: saved.fromLatest && merged.length <= 40,
          cursor: last ? { time: last.followedAt, id: last.id } : saved.cursor,
        };
      },
      { staleTime: Infinity, force: true, discardOnError },
    );
  };
  const refresh = () => {
    if (!active.current || task.busy) return;
    void task.run(
      async () => {
        await Promise.all([query.refresh(), avatars.refresh()]);
        if (entry.getSnapshot().error) throw new Error('List refresh failed.');
      },
      () => {
        list.current?.scrollToOffset({ offset: 0, animated: false });
      },
    );
  };
  return (
    <ConnectionsFrame title={title}>
      {query.data && (
        <AppText variant="caption" style={styles.context}>
          @{query.data.profile.username} ·{' '}
          {kind === 'followers'
            ? query.data.profile.followerCount
            : query.data.profile.followingCount}{' '}
          {title.toLowerCase()}
        </AppText>
      )}
      <FlatList
        ref={list}
        data={query.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        refreshing={query.loading && !!query.data}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View @${item.username}`}
              onPress={() =>
                router.push({ pathname: '/public-profile', params: { profileId: item.id } })
              }
              style={({ pressed }) => [styles.person, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Avatar
                username={item.username}
                uri={item.avatarId ? avatars.photos[item.avatarId] : null}
                size={48}
              />
              <View style={styles.name}>
                <AppText variant="label">@{item.username}</AppText>
                {item.isSelf && <AppText variant="caption">You</AppText>}
              </View>
            </Pressable>
            {!item.isSelf ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.isFollowing ? 'Unfollow' : 'Follow'} @${item.username}`}
                accessibilityState={{ disabled: task.busy || !!task.error }}
                disabled={task.busy || !!task.error}
                onPress={() =>
                  void task.run(
                    (signal) =>
                      followWithRecovery(identity, signal, () =>
                        social.follow(item.id, !item.isFollowing, signal),
                      ),
                    (receipt) => followChanged(identity, receipt),
                  )
                }
                style={({ pressed }) => [
                  styles.follow,
                  {
                    backgroundColor: item.isFollowing ? colors.surfaceMuted : colors.primary,
                    opacity: task.busy ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <AppText
                  variant="label"
                  style={{ color: item.isFollowing ? colors.text : colors.onPrimary }}
                >
                  {item.isFollowing ? 'Following' : 'Follow'}
                </AppText>
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.muted} accessible={false} />
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {query.loading ? (
              <ActivityIndicator
                accessibilityLabel={`Loading ${title.toLowerCase()}`}
                color={colors.primary}
              />
            ) : (
              <>
                <Ionicons name="people-outline" size={40} color={colors.muted} />
                <AppText variant="heading">
                  {query.error
                    ? 'List unavailable'
                    : kind === 'followers'
                      ? 'No followers yet'
                      : 'Not following anyone yet'}
                </AppText>
                <AppText variant="caption">
                  {query.error
                    ? 'Pull down to try again.'
                    : kind === 'followers'
                      ? 'Learners who follow this profile will appear here.'
                      : 'Followed learners will appear here.'}
                </AppText>
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {(query.error || task.error) && (
              <>
                <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
                  {task.error ?? 'Connections could not be loaded.'}
                </AppText>
                <Button label="Refresh list" variant="secondary" onPress={refresh} />
              </>
            )}
            {query.loading && !!query.data && (
              <ActivityIndicator
                accessibilityLabel="Loading more learners"
                color={colors.primary}
              />
            )}
            {query.data?.hasMore && (
              <Button
                label="More learners"
                variant="secondary"
                disabled={query.loading || task.busy}
                onPress={more}
              />
            )}
            {query.data && !query.data.fromLatest && (
              <Button label="Back to latest" variant="ghost" onPress={refresh} />
            )}
          </View>
        }
      />
    </ConnectionsFrame>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 },
  context: { paddingHorizontal: 24, paddingBottom: 8 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  name: { flex: 1, gap: 4 },
  follow: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 28, gap: 14 },
  footer: { paddingTop: 20, gap: 12 },
});
