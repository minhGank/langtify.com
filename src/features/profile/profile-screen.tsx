import { TabHeading } from '@/components/ui/tab-heading';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';
import { ProgressDetails, useProgress } from '@/features/progress/progress-panel';
import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { ProfileSafety } from '@/features/safety/profile-safety';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ProfileIdentity } from './profile-identity';
import { Button } from '@/components/ui/button';
import { invalidateServerData, serverScope } from '@/lib/server-cache';

export function ProfileScreen() {
  const { session, status } = useAuth();
  if (status !== 'ready' || !session) return null;
  return (
    <ProfileContent
      key={serverScope(session.user.id, session.access_token)}
      userId={session.user.id}
      token={session.access_token}
    />
  );
}
function ProfileContent({ userId, token }: { userId: string; token: string }) {
  const { colors } = useAppTheme();
  const { account } = useAuth();
  const [progressExpanded, setProgressExpanded] = useState(false);
  const progress = useProgress({ userId, accessToken: token });
  const learning = account?.learning;
  const target = account?.languages.find(
    (language) => language.id === learning?.target_language_id,
  );
  return (
    <Screen
      hasTabBar
      onRefresh={() => {
        invalidateServerData(['public-profile', 'progress'], { scope: serverScope(userId, token) });
      }}
    >
      <TabHeading title="Profile" />
      <ProfileIdentity
        userId={userId}
        token={token}
        username={account?.profile?.username ?? ''}
        level={progress.data?.level}
        learningLabel={target ? `${target.name} · ${learning?.cefr_level}` : undefined}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="My photos"
        onPress={() => router.navigate('/vocabulary')}
        style={({ pressed }) => [
          styles.settingsRow,
          {
            backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Ionicons name="images-outline" size={22} color={colors.textPrimary} accessible={false} />
        <AppText variant="label" style={styles.settingsText}>
          My photos
        </AppText>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textSecondary}
          accessible={false}
        />
      </Pressable>
      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Learning progress"
          accessibilityState={{ expanded: progressExpanded }}
          onPress={() => setProgressExpanded((expanded) => !expanded)}
          style={styles.progressToggle}
        >
          <AppText variant="label" style={styles.settingsText}>
            Learning progress
          </AppText>
          <Ionicons
            name={progressExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
            accessible={false}
          />
        </Pressable>
        {progress.error && (
          <View>
            <AppText variant="caption">We couldn’t load your progress. Try again.</AppText>
            <Button
              label="Retry progress"
              variant="ghost"
              onPress={() => void progress.refresh()}
            />
          </View>
        )}
        {progressExpanded && !progress.data && !progress.error && (
          <ActivityIndicator accessibilityLabel="Loading progress" color={colors.brandPrimary} />
        )}
        {progressExpanded && progress.data && (
          <ProgressDetails data={progress.data} showLevel={false} />
        )}
      </View>
      <View style={styles.section}>
        <AppText variant="label" style={{ color: colors.textSecondary }}>
          ACCOUNT
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Learning preferences"
          onPress={() => router.push('/learning-settings')}
          style={[
            styles.settingsRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="book-outline" size={22} color={colors.textPrimary} accessible={false} />
          <AppText style={styles.settingsText}>Learning preferences</AppText>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
            accessible={false}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          onPress={() => router.push('/notification-settings')}
          style={[
            styles.settingsRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
          <AppText style={styles.settingsText}>Notification settings</AppText>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        <ProfileSafety userId={userId} token={token} />
      </View>
      <SignOutButton />
    </Screen>
  );
}
const styles = StyleSheet.create({
  progressToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 },
  section: { gap: 12 },
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
