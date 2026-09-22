import { useMemo } from 'react';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { progressGateway, type Progress, type ProgressIdentity } from '@/services/progress';
import { useProgressRead } from './use-progress-read';

const cache = createServerCache<Progress>({ maxEntries: 12 });

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
  const resource = useMemo(
    () =>
      cache.entry(`${serverScope(userId, accessToken)}:progress:${challengeId ?? 'today'}`, [
        'progress',
      ]),
    [userId, accessToken, challengeId],
  );
  const { data, error, refresh } = useProgressRead(load, resource);
  const { colors } = useAppTheme();
  if (!data)
    return error ? (
      <View style={styles.loading}>
        <AppText variant="caption">Progress is unavailable.</AppText>
        <Button label="Retry progress" variant="ghost" onPress={() => void refresh()} />
      </View>
    ) : (
      <ActivityIndicator accessibilityLabel="Loading progress" color={colors.primary} />
    );
  if (!detailed)
    return (
      <View style={[styles.daily, { backgroundColor: colors.primarySoft }]}>
        <View style={styles.row}>
          <AppText variant="heading">{data.completedWords} / 3 completed</AppText>
          <AppText variant="caption">{data.totalXp} XP</AppText>
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Daily challenge progress"
          accessibilityValue={{ min: 0, max: 3, now: data.completedWords }}
          style={styles.segments}
        >
          {[1, 2, 3].map((word) => (
            <View
              key={word}
              style={[
                styles.segment,
                { backgroundColor: data.completedWords >= word ? colors.primary : colors.border },
              ]}
            />
          ))}
        </View>
        {data.completedWords === 3 && (
          <View style={styles.completion}>
            <AppText variant="label" style={{ color: colors.success }}>
              Daily Challenge Complete
            </AppText>
            <AppText variant="caption" style={{ color: colors.success }}>
              +10 XP bonus
            </AppText>
          </View>
        )}
        <View style={styles.row}>
          <AppText variant="label">🔥 {data.currentStreak} day streak</AppText>
          <AppText variant="caption">Level {data.level}</AppText>
        </View>
      </View>
    );
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.row}>
        <AppText variant="heading">Level {data.level}</AppText>
        <AppText variant="label" style={{ color: colors.primary }}>
          {data.totalXp} XP
        </AppText>
      </View>
      <View style={styles.loading}>
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
        <AppText variant="caption">
          {data.totalXp} / {data.nextLevelXp} XP · next level
        </AppText>
      </View>
      <View style={[styles.stats, { borderColor: colors.border }]}>
        <Stat value={`${data.currentStreak}`} label="Current streak" suffix="days" />
        <Stat value={`${data.longestStreak}`} label="Longest streak" suffix="days" />
        <Stat value={`${data.totalWordsCompleted}`} label="Words completed" />
        <Stat value={`${data.totalChallengesCompleted}`} label="Full challenges" />
      </View>
    </View>
  );
}
function Stat({ value, label, suffix }: { value: string; label: string; suffix?: string }) {
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${value}${suffix ? ` ${suffix}` : ''}`}
    >
      <AppText variant="heading">
        {value}
        {suffix ? <AppText variant="caption"> {suffix}</AppText> : null}
      </AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  daily: { padding: 20, borderRadius: 24, gap: 16 },
  card: { padding: 20, borderWidth: 1, borderRadius: 24, gap: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  segments: { flexDirection: 'row', gap: 6 },
  segment: { height: 6, borderRadius: 3, flex: 1 },
  completion: { gap: 4 },
  loading: { gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  stats: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  stat: { flexBasis: '42%', flexGrow: 1, gap: 4 },
});
