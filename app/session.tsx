import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { PreparationState } from '@/components/ui/preparation-state';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { useAppTheme } from '@/hooks/use-app-theme';

export default function SessionScreen() {
  const { status, reload } = useAuth();
  const { colors } = useAppTheme();
  if (status === 'loading')
    return (
      <Screen>
        <View
          style={{ flexGrow: 1, width: '100%', justifyContent: 'center', alignItems: 'center' }}
        >
          <BrandLogo compact />
          <PreparationState title="Getting things ready…" label="Restoring your account" />
        </View>
      </Screen>
    );
  return (
    <Screen>
      <View
        style={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: 24,
          paddingVertical: 40,
          maxWidth: 400,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <BrandLogo compact />
        </View>
        {status === 'unconfigured' ? (
          <AppText style={{ textAlign: 'center' }}>
            This version of Langtify isn’t ready to connect. Please use the latest build.
          </AppText>
        ) : (
          <>
            <AppText style={{ color: colors.error, textAlign: 'center' }} accessibilityRole="alert">
              We couldn’t load your account. Check your connection and try again.
            </AppText>
            <Button label="Try again" onPress={reload} />
            <SignOutButton />
          </>
        )}
      </View>
    </Screen>
  );
}
