import { useCallback, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from '@/components/ui/icon-button';
import { Avatar } from '@/components/ui/avatar';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { safetyGateway } from '@/services/safety';
import { serverScope } from '@/lib/server-cache';
import { useServerQuery } from '@/hooks/use-server-query';
import { useConnectionAvatars } from '@/features/social/connections-avatars';
import { feedback } from '@/lib/haptics';
import { SafetyUnavailable, type SafetyIdentity, type BlockedUser } from './model';
import { useSafetyTask } from './use-safety-task';
import { blockedCache, unblockChanged, unblockWithRecovery } from './blocked-cache';

export function BlockedUsersScreen() {
  const { status, session } = useAuth();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  return status === 'ready' && identity ? (
    <BlockedUsers key={`${identity.userId}:${identity.token}`} identity={identity} />
  ) : null;
}
function BlockedUsers({ identity }: { identity: SafetyIdentity }) {
  const { colors } = useAppTheme();
  const [notice, setNotice] = useState('');
  const list = useRef<FlatList<BlockedUser>>(null);
  const gateway = useMemo(() => safetyGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      blockedCache.entry(`${serverScope(identity.userId, identity.token)}:blocked-users`, [
        'blocked-users',
        'safety',
      ]),
    [identity],
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await gateway.blocks(null, signal);
      return { ...page, cursor: page.items.at(-1)?.id ?? null, olderWindow: false };
    },
    [gateway],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError: unavailable });
  const task = useSafetyTask(
    () => setNotice(''),
    undefined,
    () => entry.clear(),
  );
  const page = query.data;
  const avatars = useConnectionAvatars(
    identity,
    page?.items.flatMap((row) => (row.avatarId ? [row.avatarId] : [])) ?? [],
    'blocked',
  );
  const more = () => {
    if (!page?.hasMore || !page.cursor || query.loading || task.busy) return;
    const revision = entry.getRevision();
    void task.run(
      (signal) => gateway.blocks(page.cursor, signal),
      (next) => {
        if (entry.getRevision() !== revision) return;
        const seen = new Set(page.items.map((item) => item.id));
        const combined = [...page.items, ...next.items.filter((item) => !seen.has(item.id))];
        entry.set({
          ...next,
          items: combined.slice(-40),
          cursor: next.items.at(-1)?.id ?? page.cursor,
          olderWindow: page.olderWindow || combined.length > 40,
        });
      },
    );
  };
  const refresh = () =>
    void task.run(
      async () => {
        await Promise.all([query.refresh(), avatars.refresh()]);
        if (entry.getSnapshot().error) throw new Error('Refresh failed.');
      },
      () => {
        setNotice('');
        list.current?.scrollToOffset({ offset: 0, animated: false });
      },
    );
  const error =
    task.error ?? (query.error ? 'We couldn’t load blocked accounts. Try again.' : null);
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
        />
        <AppText variant="heading">Blocked accounts</AppText>
      </View>
      <FlatList
        ref={list}
        data={page?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={query.loading && !!page}
        ListHeaderComponent={
          <View style={styles.messages}>
            {!!notice && <AppText accessibilityLiveRegion="polite">{notice}</AppText>}
            {!!error && (
              <>
                <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                  {error}
                </AppText>
                <Button
                  label="Refresh blocked accounts"
                  variant="secondary"
                  onPress={refresh}
                  disabled={task.busy}
                />
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View blocked account @${item.username}`}
              disabled={task.busy}
              onPress={() =>
                router.push({ pathname: '/public-profile', params: { blockId: item.id } })
              }
              style={({ pressed }) => [
                styles.person,
                { backgroundColor: pressed ? colors.surfaceMuted : undefined },
              ]}
            >
              <Avatar
                username={item.username}
                uri={item.avatarId ? avatars.photos[item.avatarId] : undefined}
                size={48}
              />
              <AppText style={styles.username}>@{item.username}</AppText>
            </Pressable>
            <Button
              label="Unblock"
              accessibilityLabel={`Unblock @${item.username}`}
              variant="secondary"
              disabled={task.busy || query.loading}
              onPress={() =>
                void task.run(
                  (signal) =>
                    unblockWithRecovery(identity, signal, () => gateway.unblock(item.id, signal)),
                  () => {
                    unblockChanged(identity, item.id);
                    setNotice(`@${item.username} unblocked`);
                    feedback.confirm();
                  },
                )
              }
            />
          </View>
        )}
        ListEmptyComponent={
          !error ? (
            <View style={styles.empty}>
              {query.loading ? (
                <ActivityIndicator
                  accessibilityLabel="Loading blocked accounts"
                  color={colors.brandPrimary}
                />
              ) : (
                <AppText variant="subtitle">No blocked accounts</AppText>
              )}
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.messages}>
            {page?.hasMore && (
              <Button
                label="More accounts"
                variant="ghost"
                disabled={task.busy || query.loading}
                onPress={more}
              />
            )}
            {page?.olderWindow && (
              <Button
                label="Back to first accounts"
                variant="ghost"
                disabled={task.busy || query.loading}
                onPress={refresh}
              />
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
const unavailable = (cause: unknown) => cause instanceof SafetyUnavailable;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 160,
    minHeight: 52,
    borderRadius: 12,
  },
  username: { flex: 1, fontWeight: '600' },
  messages: { gap: 12, paddingVertical: 12 },
  empty: { paddingVertical: 48, alignItems: 'center' },
});
