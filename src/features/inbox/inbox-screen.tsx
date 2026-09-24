import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { inboxGateway, type InboxNotification } from '@/services/inbox';
import type { SafetyIdentity } from '@/features/safety/model';
import { inboxDestination } from './navigation';
import { InboxRow } from './inbox-row';
import { useInbox } from './use-inbox';

export function InboxScreen() {
  const { status, session } = useAuth();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  if (status !== 'ready' || !identity) return null;
  return <InboxContent key={`${identity.userId}:${identity.token}`} identity={identity} />;
}
export function InboxContent({ identity }: { identity: SafetyIdentity }) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => inboxGateway(identity), [identity]);
  const state = useInbox(identity, gateway);
  const list = useRef<FlatList<InboxNotification>>(null);
  const backToLatest = async () => {
    if (await state.refresh()) list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const error =
    state.taskError ??
    (state.error ? 'Notifications could not be loaded. Pull down to try again.' : null);
  const disabled = state.busy || state.loading;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <IconButton
            name="chevron-back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <AppText variant="heading">Notifications</AppText>
        </View>
        <View style={styles.summary}>
          <AppText variant="caption">
            {state.data?.unreadCount ? `${state.data.unreadCount} unread` : 'Your latest updates'}
          </AppText>
          {!!state.data?.unreadCount && state.data.readCursor && (
            <Button
              label="Mark all read"
              variant="ghost"
              disabled={disabled}
              onPress={state.readAll}
            />
          )}
        </View>
      </View>
      <FlatList
        ref={list}
        data={state.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={state.loading && !!state.data}
        onRefresh={state.refresh}
        renderItem={({ item }) => (
          <InboxRow
            item={item}
            disabled={disabled}
            toggleRead={() => state.read(item)}
            open={() => state.open(item, (target) => router.push(inboxDestination(target)))}
          />
        )}
        ListHeaderComponent={
          error ? (
            <View style={styles.error}>
              <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                {error}
              </AppText>
              <Button
                label="Refresh notifications"
                variant="secondary"
                onPress={state.refresh}
                disabled={disabled}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {state.loading ? (
              <ActivityIndicator
                color={colors.brandPrimary}
                accessibilityLabel="Loading notifications"
              />
            ) : (
              !error && (
                <>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
                    <Ionicons
                      name="notifications-outline"
                      size={32}
                      color={colors.brandPrimary}
                      accessible={false}
                    />
                  </View>
                  <AppText variant="heading">All caught up</AppText>
                  <AppText variant="subtitle" style={styles.emptyText}>
                    New followers, photo ratings and daily words will appear here.
                  </AppText>
                </>
              )
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {state.data?.hasMore && (
              <Button
                label="Earlier notifications"
                variant="secondary"
                disabled={disabled}
                loading={state.busy}
                onPress={state.more}
              />
            )}
            {state.data?.olderWindow && (
              <Button
                label="Back to latest notifications"
                variant="ghost"
                disabled={disabled}
                onPress={() => void backToLatest()}
              />
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summary: {
    minHeight: 50,
    paddingLeft: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  empty: {
    flex: 1,
    minHeight: 240,
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { textAlign: 'center' },
  error: { gap: 12, paddingVertical: 12 },
  footer: { gap: 12, paddingTop: 8 },
});
