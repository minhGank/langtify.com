import { TabHeading } from '@/components/ui/tab-heading';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { ProgressPanel } from '@/features/progress/progress-panel';
import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { ProfileSafety } from '@/features/safety/profile-safety';
import { useAppTheme } from '@/hooks/use-app-theme';
import { timezoneLabel } from '@/features/onboarding/timezones';
import { ProfileIdentity } from './profile-identity';
import { Button } from '@/components/ui/button';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { invalidateDiscoverWindow } from '@/features/discover/use-discover';

export function ProfileScreen() {
  const { colors } = useAppTheme();
  const { account, session } = useAuth();
  const learning = account?.learning;
  const target = account?.languages.find(
    (language) => language.id === learning?.target_language_id,
  );
  const reference = account?.languages.find(
    (language) => language.id === learning?.reference_language_id,
  );
  return (
    <Screen
      hasTabBar
      onRefresh={() => {
        if (!session) return;
        const scope = serverScope(session.user.id, session.access_token);
        invalidateServerData(['public-profile', 'progress'], { scope });
        const profileId = account?.profile?.public_id;
        if (profileId && learning)
          invalidateDiscoverWindow(
            `${scope}:public-posts:${profileId}:${learning.target_language_id}`,
          );
      }}
    >
      <TabHeading title="Profile" />
      {session && (
        <ProfileIdentity
          key={session.user.id}
          userId={session.user.id}
          token={session.access_token}
          username={account?.profile?.username ?? ''}
        />
      )}
      {session && (
        <ProgressPanel
          key={`${session.user.id}:${learning?.timezone}`}
          userId={session.user.id}
          accessToken={session.access_token}
          detailed
        />
      )}
      <View style={styles.section}>
        <AppText variant="label" style={{ color: colors.muted }}>
          LEARNING SETUP
        </AppText>
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.row}>
            <AppText style={{ color: colors.muted }}>Learning</AppText>
            <AppText variant="label">
              {target?.name ?? 'Unavailable'} · {learning?.cefr_level}
            </AppText>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <AppText style={{ color: colors.muted }}>Reference language</AppText>
            <AppText variant="label" style={styles.value}>
              {reference?.name ?? 'Unavailable'}
            </AppText>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <AppText style={{ color: colors.muted }}>Timezone</AppText>
            <AppText variant="label" style={styles.value}>
              {timezoneLabel(learning?.timezone ?? '')}
            </AppText>
          </View>
          <Button
            label="Edit learning preferences"
            variant="ghost"
            onPress={() => router.push('/learning-settings')}
          />
        </View>
      </View>
      <View style={styles.section}>
        <AppText variant="label" style={{ color: colors.muted }}>
          ACCOUNT
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          onPress={() => router.push('/notification-settings')}
          style={[
            styles.settingsRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          <AppText style={styles.settingsText}>Notification settings</AppText>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        {session && (
          <ProfileSafety
            key={`${session.user.id}:${session.access_token}`}
            userId={session.user.id}
            token={session.access_token}
          />
        )}
      </View>
      <SignOutButton />
    </Screen>
  );
}
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: 4 },
  section: { gap: 12 },
  card: { padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, gap: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  value: { flexShrink: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  settingsText: { flex: 1 },
});
