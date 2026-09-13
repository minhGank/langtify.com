import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { progressGateway, type ProgressIdentity } from '@/services/progress';
import { useProgressRead } from './use-progress-read';

export function ProgressPanel({
  userId,
  accessToken,
  challengeId,
  detailed = false,
}: ProgressIdentity & { challengeId?: string; detailed?: boolean }) {
  const load = useMemo(
    () => progressGateway({ userId, accessToken }, challengeId),
    [userId, accessToken, challengeId],
  );
  const { data, error, refresh } = useProgressRead(load);
  const { colors } = useAppTheme();
  if (!data)
    return error ? (
      <View>
        <AppText>Progress is unavailable.</AppText>
        <Button label="Retry progress" onPress={() => void refresh()} />
      </View>
    ) : (
      <AppText>Loading progress…</AppText>
    );
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {!detailed && <AppText>{data.completedWords} / 3 completed</AppText>}
      {!detailed && data.completedWords === 3 && (
        <>
          <AppText accessibilityRole="header">Daily Challenge Complete</AppText>
          <AppText>+10 XP bonus</AppText>
        </>
      )}
      <AppText accessibilityRole="header">Level {data.level}</AppText>
      <AppText>{data.totalXp} XP</AppText>
      {detailed && (
        <>
          <AppText>
            {data.totalXp} / {data.nextLevelXp} XP · next level
          </AppText>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Progress toward next level"
            accessibilityValue={{ min: 0, max: data.xpForNextLevel, now: data.xpIntoLevel }}
            style={[styles.track, { backgroundColor: colors.border }]}
          >
            <View
              style={{
                height: 8,
                width: `${(100 * data.xpIntoLevel) / data.xpForNextLevel}%`,
                backgroundColor: colors.primary,
              }}
            />
          </View>
        </>
      )}
      <AppText>
        {detailed
          ? `🔥 Current streak: ${data.currentStreak}`
          : `🔥 ${data.currentStreak} day streak`}
      </AppText>
      {detailed && (
        <>
          <AppText>🏆 Longest streak: {data.longestStreak}</AppText>
          <AppText>Total words completed: {data.totalWordsCompleted}</AppText>
          <AppText>Fully completed challenges: {data.totalChallengesCompleted}</AppText>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, borderRadius: 16, gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
