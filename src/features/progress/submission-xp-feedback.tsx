import { useMemo, useState } from 'react';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AccentBadge } from '@/components/ui/accent-badge';
import { MotionView } from '@/components/ui/motion-view';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { receiptGateway, type XpReceipt, type ProgressIdentity } from '@/services/progress';
import { useProgressRead } from './use-progress-read';

const cache = createServerCache<XpReceipt>({ maxEntries: 12 });

export function SubmissionXpFeedback({
  userId,
  accessToken,
  submissionId,
  historical = false,
  celebrate = false,
}: ProgressIdentity & { submissionId: string; historical?: boolean; celebrate?: boolean }) {
  const load = useMemo(
    () => receiptGateway({ userId, accessToken }, submissionId),
    [userId, accessToken, submissionId],
  );
  const resource = useMemo(
    () => cache.entry(`${serverScope(userId, accessToken)}:receipt:${submissionId}`, ['progress']),
    [userId, accessToken, submissionId],
  );
  const { data, error, refresh } = useProgressRead(load, resource);
  const { colors } = useAppTheme();
  const hasReward =
    !!data && (data.wordXp > 0 || data.challengeBonusXp > 0 || data.milestoneXp > 0);
  const [presentation, setPresentation] = useState({ resource, seen: false, enter: false });
  // Consume the acknowledgement on the first actual receipt, without an effect
  // that replays it when cache revalidation restores a temporarily absent reward.
  if (presentation.resource !== resource)
    setPresentation({ resource, seen: hasReward, enter: celebrate && hasReward });
  else if (hasReward && !presentation.seen)
    setPresentation({ resource, seen: true, enter: celebrate });
  else if (!hasReward && presentation.enter)
    setPresentation({ resource, seen: true, enter: false });
  const animateReceipt = celebrate && hasReward && presentation.enter;
  if (!data)
    return error ? (
      <>
        <AppText variant="caption">Photo added. We couldn’t load your XP yet.</AppText>
        <Button label="Refresh XP" variant="ghost" onPress={() => void refresh()} />
      </>
    ) : (
      <AppText variant="caption">Loading XP…</AppText>
    );
  if (data.wordXp === 0 && data.challengeBonusXp === 0 && data.milestoneXp === 0) return null;
  const milestone = data.milestoneXp > 0;
  const dailyComplete = data.challengeBonusXp > 0;
  return (
    <MotionView
      trigger={submissionId}
      kind={milestone || dailyComplete ? 'reward' : 'change'}
      animateOnMount={animateReceipt}
      style={[styles.feedback, { backgroundColor: colors.surfaceMuted }]}
    >
      {(milestone || dailyComplete) && (
        <View style={styles.heading}>
          <Ionicons
            name={milestone ? 'sparkles' : 'checkmark-circle'}
            size={milestone ? 28 : 22}
            color={milestone ? colors.accentReward : colors.success}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <AppText variant={milestone ? 'heading' : 'label'} style={styles.headingText}>
            {milestone ? 'Streak milestone reached' : 'Daily challenge complete'}
          </AppText>
        </View>
      )}
      {data.wordXp > 0 && (
        <AccentBadge
          tone="reward"
          announce={animateReceipt}
          label={`+${data.wordXp} XP${historical ? '' : ' · word completed'}`}
        />
      )}
      {data.challengeBonusXp > 0 && (
        <AccentBadge tone="reward" label={`+${data.challengeBonusXp} XP · full challenge bonus`} />
      )}
      {data.milestoneXp > 0 && (
        <AccentBadge
          tone="reward"
          icon="sparkles-outline"
          label={`+${data.milestoneXp} XP · streak milestone`}
        />
      )}
    </MotionView>
  );
}
const styles = StyleSheet.create({
  feedback: { borderRadius: 16, padding: 16, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  headingText: { flex: 1 },
});
