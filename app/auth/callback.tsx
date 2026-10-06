import { Redirect, router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useGoogleLogin } from '@/features/auth/oauth/google-button';
import { useSyncExternalStore } from 'react';
import { recovery, coordinator } from '@/features/auth/oauth/runtime';
export default function OAuthCallback() {
  const auth = useAuth();
  const reset = useSyncExternalStore(recovery.subscribe, recovery.snapshot, recovery.snapshot);
  const oauth = useGoogleLogin();
  if (
    auth.status === 'signed-out' &&
    ['ready', 'updating', 'success', 'failed'].includes(reset.phase)
  )
    return <Redirect href="/set-new-password" />;
  if (auth.status === 'ready') return <Redirect href="/" />;
  if (auth.status === 'onboarding') return <Redirect href="/onboarding" />;
  return (
    <Screen>
      <AppText variant="title">
        {reset.phase === 'receiving' || reset.phase === 'error'
          ? 'Reset password'
          : 'Account verification'}
      </AppText>
      <AppText>
        {reset.phase === 'receiving'
          ? 'Checking your reset link…'
          : reset.phase === 'error'
            ? reset.message
            : oauth.busy || auth.status === 'loading'
              ? 'Finishing sign-in…'
              : 'This link is invalid or has expired. Return to Sign in to start again.'}
      </AppText>
      <Button
        label="Back to sign in"
        onPress={() => {
          void Promise.all([coordinator.cancel(), recovery.cancel()])
            .catch(() => {})
            .finally(() => router.replace('/sign-in'));
        }}
      />
    </Screen>
  );
}
