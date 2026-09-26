import { Link } from 'expo-router';
import { View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';

export function SignupConfirmation({
  email,
  busy,
  requestedAgain,
  resend,
  changeEmail,
}: {
  email: string;
  busy: boolean;
  requestedAgain: boolean;
  resend: () => void;
  changeEmail: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={{ gap: 16 }}>
      <AppText variant="label">{email}</AppText>
      <AppText>
        If you can create an account with this email, you’ll receive a verification link. Open it,
        then return to sign in.
      </AppText>
      <AppText variant="caption">
        Check your spam folder, too. Already joined? Use your usual sign-in method.
      </AppText>
      {requestedAgain && (
        <AppText accessibilityLiveRegion="polite">
          If verification is still needed, look for a new link. Allow a few minutes for it to
          arrive.
        </AppText>
      )}
      <Button label="Resend verification" variant="secondary" loading={busy} onPress={resend} />
      {!busy && (
        <Link href="/sign-in" accessibilityRole="link" style={{ padding: 14, textAlign: 'center' }}>
          <AppText style={{ color: colors.brandText }}>Sign in</AppText>
        </Link>
      )}
      <Button label="Use another email" variant="ghost" disabled={busy} onPress={changeEmail} />
    </View>
  );
}
