import { useMemo } from 'react';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { receiptGateway, type ProgressIdentity } from '@/services/progress';
import { useProgressRead } from './use-progress-read';

export function SubmissionXpFeedback({
  userId,
  accessToken,
  submissionId,
}: ProgressIdentity & { submissionId: string }) {
  const load = useMemo(
    () => receiptGateway({ userId, accessToken }, submissionId),
    [userId, accessToken, submissionId],
  );
  const { data, error, refresh } = useProgressRead(load);
  if (!data)
    return error ? (
      <>
        <AppText>Photo saved. XP feedback is unavailable.</AppText>
        <Button label="Refresh XP" onPress={() => void refresh()} />
      </>
    ) : (
      <AppText>Checking earned XP…</AppText>
    );
  return (
    <>
      {data.wordXp > 0 && (
        <AppText accessibilityLiveRegion="polite">+{data.wordXp} XP · word completed</AppText>
      )}
      {data.challengeBonusXp > 0 && (
        <AppText>+{data.challengeBonusXp} XP · full challenge bonus</AppText>
      )}
      {data.milestoneXp > 0 && <AppText>+{data.milestoneXp} XP · streak milestone</AppText>}
    </>
  );
}
