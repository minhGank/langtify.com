import { displayTerm } from '@/utils/display-term';
import { TabHeading } from '@/components/ui/tab-heading';
import { useCallback, useMemo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { ProgressPanel } from '@/features/progress/progress-panel';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { IconButton } from '@/components/ui/icon-button';
import { MotionView } from '@/components/ui/motion-view';
import { useAuth } from '@/features/auth/auth-provider';
import { useTodayChallenge } from '@/features/challenges/use-today-challenge';
import { UnfinishedPhotos } from '@/features/photos/unfinished-photos';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  challengeGateway,
  type ChallengeIdentity,
  type ChallengeWord,
} from '@/services/challenges';

export function TodayScreen() {
  const { session, account } = useAuth();
  const learning = account?.learning;
  if (!session || !learning)
    return (
      <Screen hasTabBar>
        <TabHeading title="Today's Challenge" />
        <AppText>We couldn’t load your learning settings. Try signing in again.</AppText>
      </Screen>
    );
  const key = [
    session.user.id,
    learning.id,
    learning.target_language_id,
    learning.reference_language_id,
    learning.cefr_level,
    learning.timezone,
  ].join(':');
  return (
    <TodayContent
      key={key}
      userId={session.user.id}
      learningId={learning.id}
      accessToken={session.access_token}
      cacheKey={key}
      timezone={learning.timezone}
    />
  );
}
function TodayContent(identity: ChallengeIdentity & { cacheKey: string; timezone: string }) {
  const { colors } = useAppTheme();
  const { userId, learningId, accessToken } = identity;
  const gateway = useMemo(
    () => challengeGateway({ userId, learningId, accessToken }),
    [userId, learningId, accessToken],
  );
  const {
    challenge,
    loading,
    replacing,
    error,
    replacementError,
    refresh,
    ensureFresh,
    replace,
    subscribe,
  } = useTodayChallenge(
    gateway,
    `${serverScope(userId, accessToken)}:challenge:${identity.cacheKey}`,
  );
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      if (AppState.currentState === 'active') void ensureFresh();
      const unsubscribe = subscribe(() => {
        if (focused && AppState.currentState === 'active') void ensureFresh();
      });
      const listener = AppState.addEventListener('change', (state) => {
        if (focused && state === 'active') void ensureFresh();
      });
      // A local timer only schedules a server read at the next timezone day
      // boundary. The RPC still chooses the date; no device date enters it.
      let timer: ReturnType<typeof setTimeout>;
      const schedule = () => {
        timer = setTimeout(() => {
          if (focused && AppState.currentState === 'active') void refresh(true);
          if (focused) schedule();
        }, nextDayDelay(identity.timezone));
      };
      schedule();
      return () => {
        focused = false;
        unsubscribe();
        listener.remove();
        clearTimeout(timer);
      };
    }, [refresh, ensureFresh, subscribe, identity.timezone]),
  );
  return (
    <Screen
      hasTabBar
      refreshing={loading}
      onRefresh={() => {
        invalidateServerData(['progress', 'unfinished-photos']);
        void refresh();
      }}
    >
      <TabHeading title="Today's Challenge" />
      <ProgressPanel
        key={`${serverScope(userId, accessToken)}:${challenge?.id ?? 'today'}`}
        userId={userId}
        accessToken={accessToken}
        challengeId={challenge?.id}
      />
      {loading && !challenge && (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading challenge">
          <ActivityIndicator />
          <AppText>Finding today’s words…</AppText>
        </View>
      )}
      {error ? (
        <>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </AppText>
          <Button label="Reload words" onPress={() => void refresh()} />
        </>
      ) : null}
      {challenge && (
        <>
          <AppText variant="caption">Find these words in the world around you.</AppText>
          {challenge.words.map((word) => (
            <WordCard
              key={`${challenge.id}:${word.slot}`}
              word={word}
              loading={replacing === word.id}
              disabled={replacing !== null}
              onReplace={() => void replace(word.id)}
            />
          ))}
          {replacementError ? (
            <View style={styles.word}>
              <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                {replacementError}
              </AppText>
              <Button label="Refresh Today" variant="secondary" onPress={() => void refresh()} />
            </View>
          ) : null}
        </>
      )}
      <UnfinishedPhotos
        userId={userId}
        token={accessToken}
        currentAssignments={challenge?.words.map((word) => word.id) ?? []}
      />
    </Screen>
  );
}
function WordCard({
  word,
  loading,
  disabled,
  onReplace,
}: {
  word: ChallengeWord;
  loading: boolean;
  disabled: boolean;
  onReplace: () => void;
}) {
  const { colors } = useAppTheme();
  const label = word.slot[0].toUpperCase() + word.slot.slice(1);
  const completed = word.submission?.status === 'completed';
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.row}>
        <AppText variant="caption">
          {label} · {word.cefrLevel}
        </AppText>
        {completed ? (
          <View style={styles.status}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <AppText variant="caption" style={{ color: colors.success }}>
              {word.submission?.captureKind === 'historical' ? 'Captured' : 'Completed'}
            </AppText>
          </View>
        ) : !word.submission ? (
          <IconButton
            name="refresh-outline"
            label="Replace"
            hint={`Replace the ${word.slot} word: ${displayTerm(word.targetTerm)}`}
            disabled={disabled || loading}
            onPress={onReplace}
          />
        ) : (
          <AppText variant="caption">
            {word.submission.status === 'deleting' ? 'Deleting…' : 'Photo in progress'}
          </AppText>
        )}
      </View>
      <MotionView trigger={word.id} style={styles.word}>
        <AppText accessibilityRole="header" variant="heading" style={styles.term}>
          {displayTerm(word.targetTerm)}
        </AppText>
        <AppText style={{ color: colors.textSecondary }}>{displayTerm(word.referenceTerm)}</AppText>
      </MotionView>
      <Button
        label={completed ? 'View photo' : word.submission ? 'Resume photo' : 'Take photo'}
        accessibilityLabel={
          completed
            ? `View photo · ${word.slot}`
            : word.submission
              ? `Resume photo · ${word.slot}`
              : `Take photo · ${word.slot}`
        }
        variant={completed ? 'secondary' : 'primary'}
        loading={loading}
        disabled={disabled}
        onPress={() =>
          router.push({
            pathname: '/photo',
            params: { assignmentId: word.id, ...(!word.submission ? { capture: '1' } : {}) },
          })
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, borderRadius: 24, gap: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 36,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  word: { gap: 4 },
  term: { fontSize: 28, lineHeight: 34 },
});

// Find the next calendar-date change rather than assuming every day lasts 24h.
function nextDayDelay(timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const now = Date.now();
    const today = formatter.format(now);
    let low = now,
      high = now + 36 * 60 * 60 * 1000;
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2);
      if (formatter.format(middle) === today) low = middle;
      else high = middle;
    }
    return Math.max(1000, high - now + 1000);
  } catch {
    // The server may have newer IANA data than this device. Keep authority on
    // the server and check hourly until focus/resume provides another refresh.
    return 60 * 60 * 1000;
  }
}
