import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { emailCodeLength } from './email-verification';
import { SignupCodeField } from './signup-code-field';
import type { useEmailAuth } from './use-email-auth';

export function SignupConfirmation({
  auth,
  googleBusy,
}: {
  auth: ReturnType<typeof useEmailAuth>;
  googleBusy: boolean;
}) {
  const { colors } = useAppTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!auth.resendAt) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= auth.resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [auth.resendAt]);
  const remaining = Math.max(0, Math.ceil((auth.resendAt - now) / 1000));
  const busy = !!auth.operation || googleBusy;
  const valid =
    emailCodeLength !== null && new RegExp(`^[0-9]{${emailCodeLength}}$`).test(auth.code);
  return (
    <View style={styles.content}>
      <View style={styles.address}>
        <AppText variant="label" selectable>
          {auth.confirmationEmail}
        </AppText>
        <Button label="Change email" variant="ghost" disabled={busy} onPress={auth.changeEmail} />
      </View>
      <AppText variant="subtitle">
        {emailCodeLength
          ? 'If you can create an account with this email, you’ll receive a verification code. Enter it below.'
          : 'If you can create an account with this email, you’ll receive a verification link. Open it, then return to sign in.'}
      </AppText>
      {!!emailCodeLength && (
        <SignupCodeField
          length={emailCodeLength}
          value={auth.code}
          onChangeText={auth.editCode}
          disabled={busy}
          onSubmit={() => void auth.verify()}
        />
      )}
      {!!auth.error && (
        <AppText
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: colors.error }}
        >
          {auth.error}
        </AppText>
      )}
      {!!emailCodeLength && (
        <Button
          label="Verify email"
          loading={auth.operation === 'verify'}
          disabled={!valid || (busy && auth.operation !== 'verify')}
          onPress={() => void auth.verify()}
        />
      )}
      {auth.requestedAgain && (
        <AppText variant="caption" accessibilityLiveRegion="polite">
          If verification is still needed, look for a new email. Allow a few minutes for it to
          arrive.
        </AppText>
      )}
      <Button
        label={remaining ? `Resend in ${remaining}s` : 'Resend verification'}
        accessibilityLabel={
          remaining
            ? `Resend verification available in ${remaining} seconds`
            : 'Resend verification'
        }
        variant="ghost"
        loading={auth.operation === 'resend'}
        disabled={remaining > 0 || (busy && auth.operation !== 'resend')}
        onPress={() => void auth.resend()}
      />
      <AppText variant="caption" style={styles.center}>
        Check your spam folder, too. Already joined? Use your usual sign-in method.
      </AppText>
      <Link replace href="/sign-in" asChild>
        <Pressable
          disabled={busy}
          accessibilityRole="link"
          accessibilityState={{ disabled: busy }}
          style={styles.link}
        >
          <AppText style={{ color: colors.brandText, textAlign: 'center' }}>
            Back to sign in
          </AppText>
        </Pressable>
      </Link>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 20 },
  address: { gap: 2, alignItems: 'flex-start' },
  center: { textAlign: 'center' },
  link: { paddingVertical: 14, minHeight: 48 },
});
