import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { MotionView } from '@/components/ui/motion-view';
import { postAcknowledgement } from '@/features/discover/owned-post-access';
import { useAppTheme } from '@/hooks/use-app-theme';
import { receiptGateway } from '@/services/progress';

export function PhotoAddedNotice({
  userId,
  token,
  submissionId,
}: {
  userId: string;
  token: string;
  submissionId: string;
}) {
  const { colors } = useAppTheme();
  const entry = useMemo(
    () => postAcknowledgement({ userId, token }, submissionId),
    [userId, token, submissionId],
  );
  const [message, setMessage] = useState('');
  useFocusEffect(
    useCallback(() => {
      const pending = entry.getSnapshot();
      if (!pending.data || pending.retired || pending.data < performance.now()) return;
      entry.clear();
      if (AppState.currentState !== 'active') return;
      let active = true;
      setMessage('Photo added');
      const finish = () => {
        active = false;
        setMessage('');
      };
      const timer = setTimeout(finish, 4000);
      const listener = AppState.addEventListener('change', (state) => {
        if (state !== 'active') finish();
      });
      const unsubscribe = entry.subscribe(() => {
        if (entry.getSnapshot().retired) finish();
      });
      void receiptGateway({ userId, accessToken: token }, submissionId)()
        .then((receipt) => {
          if (!active) return;
          const xp = receipt.wordXp + receipt.challengeBonusXp + receipt.milestoneXp;
          if (xp > 0) setMessage(`Photo added · +${xp} XP`);
        })
        .catch(() => {
          /* Success is known; XP remains server-owned and optional here. */
        });
      return () => {
        finish();
        clearTimeout(timer);
        listener.remove();
        unsubscribe();
      };
    }, [entry, userId, token, submissionId]),
  );
  if (!message) return null;
  return (
    <MotionView
      trigger={submissionId}
      animateOnMount
      style={{ padding: 14, backgroundColor: colors.surfaceMuted }}
    >
      <AppText variant="label" accessibilityLiveRegion="polite">
        {message}
      </AppText>
    </MotionView>
  );
}
