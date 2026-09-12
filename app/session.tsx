import { ActivityIndicator } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';

export default function SessionScreen() {
  const { status, reload } = useAuth();
  return (
    <Screen>
      <AppText variant="title">Langtify</AppText>
      {status === 'loading' ? (
        <>
          <ActivityIndicator accessibilityLabel="Restoring your account" />
          <AppText>Loading your account…</AppText>
        </>
      ) : status === 'unconfigured' ? (
        <AppText>Langtify is not configured yet. Please contact the app developer.</AppText>
      ) : (
        <>
          <AppText accessibilityRole="alert">
            We could not load your account. Check your connection and try again.
          </AppText>
          <Button label="Try again" onPress={reload} />
          <SignOutButton />
        </>
      )}
    </Screen>
  );
}
