import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { deleteAccount } from '@/services/account-deletion';

export function AccountSettingsScreen() {
  const { session, status } = useAuth();
  if (!session || !['ready', 'onboarding'].includes(status)) return null;
  return (
    <AccountSettings
      key={`${session.user.id}:${session.access_token}`}
      userId={session.user.id}
      token={session.access_token}
    />
  );
}
function AccountSettings({ userId, token }: { userId: string; token: string }) {
  const { colors } = useAppTheme();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const dispatched = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function remove() {
    if (dispatched.current || confirmation !== 'DELETE') return;
    dispatched.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteAccount(token, userId);
      // AuthProvider's protected routes handle successful local sign-out.
    } catch {
      if (active.current)
        setError(
          'We couldn’t confirm deletion. Check your connection and try again. If deletion completed, your old account cannot be restored.',
        );
    } finally {
      dispatched.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <AppText variant="title">Settings</AppText>
      {!confirming ? (
        <>
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
          <Button label="Delete Account" variant="danger" onPress={() => setConfirming(true)} />
        </>
      ) : (
        <>
          <AppText variant="heading">Permanently delete your account?</AppText>
          <AppText>
            Your profile, learning history, XP, streaks, comments, ratings and follow connections
            will be permanently deleted. This cannot be undone.
          </AppText>
          <AppText>
            Your photos and avatar will become unavailable in Langtify and will be queued for
            permanent file removal. Links already opened may remain accessible briefly while cleanup
            finishes.
          </AppText>
          <FormField
            label="Type DELETE to confirm"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />
          {error ? (
            <AppText accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </AppText>
          ) : null}
          <Button
            label="Permanently delete account"
            variant="danger"
            loading={busy}
            disabled={confirmation !== 'DELETE'}
            onPress={() => void remove()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setConfirming(false);
              setConfirmation('');
              setError('');
            }}
          />
        </>
      )}
    </Screen>
  );
}
