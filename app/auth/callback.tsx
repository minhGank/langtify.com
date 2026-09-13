import { Redirect, router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useGoogleLogin } from '@/features/auth/oauth/google-button';
import { coordinator } from '@/features/auth/oauth/runtime';
export default function OAuthCallback() {
  const auth = useAuth();
  const oauth = useGoogleLogin();
  if (auth.status === 'ready') return <Redirect href="/" />;
  if (auth.status === 'onboarding') return <Redirect href="/onboarding" />;
  return (
    <Screen>
      <AppText variant="title">Google sign-in</AppText>
      <AppText>
        {oauth.busy || auth.status === 'loading'
          ? 'Finishing sign-in…'
          : oauth.message || 'This sign-in link is unavailable. Please try again.'}
      </AppText>
      <Button
        label="Back to sign in"
        onPress={() => {
          void coordinator
            .cancel()
            .catch(() => {})
            .finally(() => router.replace('/sign-in'));
        }}
      />
    </Screen>
  );
}
