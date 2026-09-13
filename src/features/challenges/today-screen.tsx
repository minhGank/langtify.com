import { useCallback, useMemo } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { ProgressPanel } from '@/features/progress/progress-panel';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useTodayChallenge } from '@/features/challenges/use-today-challenge';
import { UnfinishedPhotos } from '@/features/photos/unfinished-photos';
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
        <AppText variant="title">{"Today's Challenge"}</AppText>
        <AppText>Your learning profile is unavailable.</AppText>
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
    />
  );
}
function TodayContent(identity: ChallengeIdentity) {
  const { userId, learningId, accessToken } = identity;
  const gateway = useMemo(
    () => challengeGateway({ userId, learningId, accessToken }),
    [userId, learningId, accessToken],
  );
  const { challenge, loading, replacing, error, replacementError, refresh, replace } =
    useTodayChallenge(gateway);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      // Ask the server again across local midnight; the device never chooses the date.
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refresh(true);
      }, 60000);
      return () => {
        listener.remove();
        clearInterval(timer);
      };
    }, [refresh]),
  );
  return (
    <Screen hasTabBar>
      <AppText variant="title">{"Today's Challenge"}</AppText>
      <ProgressPanel
        key={`${userId}:${challenge?.id ?? 'today'}:${challenge?.words.map((word) => `${word.submission?.id}:${word.submission?.status}`).join(',')}`}
        userId={userId}
        accessToken={accessToken}
        challengeId={challenge?.id}
      />
      {loading && (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading challenge">
          <ActivityIndicator />
          <AppText>Loading your challenge…</AppText>
        </View>
      )}
      {error ? (
        <>
          <AppText accessibilityRole="alert">{error}</AppText>
          <Button label="Retry challenge" onPress={() => void refresh()} />
        </>
      ) : null}
      {challenge && (
        <>
          <AppText>
            {challenge.localDate} · {challenge.timezone}
          </AppText>
          {challenge.words.map((word) => (
            <WordCard
              key={word.id}
              word={word}
              loading={replacing === word.id}
              disabled={replacing !== null}
              onReplace={() => void replace(word.id)}
            />
          ))}
          {replacementError ? (
            <AppText accessibilityRole="alert">{replacementError}</AppText>
          ) : null}
          <Button
            label="Refresh challenge"
            disabled={replacing !== null}
            onPress={() => void refresh()}
          />
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
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText style={{ color: colors.muted }}>
        {label} · {word.cefrLevel}
      </AppText>
      <AppText accessibilityRole="header" style={styles.term}>
        {word.targetTerm}
      </AppText>
      <AppText>{word.referenceTerm}</AppText>
      {word.submission?.status === 'completed' ? (
        <AppText>✓ Completed</AppText>
      ) : word.submission?.status === 'deleting' ? (
        <AppText>Finishing deletion…</AppText>
      ) : null}
      <Button
        label={
          word.submission?.status === 'completed'
            ? `View Photo · ${word.slot}`
            : word.submission
              ? `Resume photo · ${word.slot}`
              : `Take Photo · ${word.slot}`
        }
        disabled={disabled}
        onPress={() => router.push({ pathname: '/photo', params: { assignmentId: word.id } })}
      />
      {!word.submission && (
        <Button
          label={`Replace ${word.slot} word`}
          loading={loading}
          disabled={disabled}
          onPress={onReplace}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, borderRadius: 16, gap: 12 },
  term: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
});
