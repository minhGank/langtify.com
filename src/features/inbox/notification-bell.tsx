import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { inboxGateway } from '@/services/inbox';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { inboxEntries } from './cache';

export function NotificationBell() {
  const { status, session } = useAuth();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  if (status !== 'ready' || !identity) return null;
  return <Bell key={`${identity.userId}:${identity.token}`} identity={identity} />;
}
function Bell({ identity }: { identity: SafetyIdentity }) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => inboxGateway(identity), [identity]);
  const entry = useMemo(
    () => inboxEntries(serverScope(identity.userId, identity.token)).summary,
    [identity],
  );
  const load = useCallback((signal: AbortSignal) => gateway.summary(signal), [gateway]);
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError: unavailable });
  const count = query.data?.unreadCount ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'}
      accessibilityHint="Open your notification inbox"
      onPress={() => router.push('/notifications')}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? colors.surfaceMuted : undefined },
      ]}
    >
      <Ionicons
        name="notifications-outline"
        size={25}
        color={colors.textPrimary}
        accessible={false}
      />
      {count > 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            { backgroundColor: colors.brandPrimary, borderColor: colors.background },
          ]}
        >
          <AppText
            style={[styles.badgeText, { color: colors.textOnPrimary }]}
            maxFontSizeMultiplier={1}
          >
            {count > 99 ? '99+' : count}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}
function unavailable(cause: unknown) {
  return cause instanceof SafetyUnavailable;
}
const styles = StyleSheet.create({
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 0,
    right: -1,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
});
