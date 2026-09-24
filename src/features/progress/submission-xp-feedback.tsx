import { useMemo } from 'react';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { StyleSheet, View } from 'react-native';
import { AccentBadge } from '@/components/ui/accent-badge';
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
}: ProgressIdentity & { submissionId: string; historical?: boolean }) {
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
  if (!data)
    return error ? (
      <>
        <AppText variant="caption">Photo saved. XP feedback is unavailable.</AppText>
        <Button label="Refresh XP" variant="ghost" onPress={() => void refresh()} />
      </>
    ) : (
      <AppText variant="caption">Checking earned XP…</AppText>
    );
  if (data.wordXp === 0 && data.challengeBonusXp === 0 && data.milestoneXp === 0) return null;
  return (
    <View style={[styles.feedback, { backgroundColor: colors.surfaceMuted }]}>
      {data.wordXp > 0 && (
        <AccentBadge
          tone="reward"
          announce
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
    </View>
  );
}
const styles = StyleSheet.create({ feedback: { borderRadius: 16, padding: 16, gap: 4 } });
