import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { useAppTheme } from '@/hooks/use-app-theme';

export default function SessionScreen() {
  const { status, reload } = useAuth();
  const { colors } = useAppTheme();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 24, paddingVertical: 40 }}>
        <BrandLogo />
        {status === 'loading' ? (
          <>
            <ActivityIndicator
              color={colors.brandPrimary}
              accessibilityLabel="Restoring your account"
            />
            <AppText style={{ color: colors.textSecondary }}>Getting things ready…</AppText>
          </>
        ) : status === 'unconfigured' ? (
          <AppText>Langtify is not configured yet. Please contact the app developer.</AppText>
        ) : (
          <>
            <AppText style={{ color: colors.error }} accessibilityRole="alert">
              We could not load your account. Check your connection and try again.
            </AppText>
            <Button label="Try again" onPress={reload} />
            <SignOutButton />
          </>
        )}
      </View>
    </Screen>
  );
}
