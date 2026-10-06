import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { GoogleButton, useGoogleLogin } from './oauth/google-button';
import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { useAppTheme } from '@/hooks/use-app-theme';
import { signupPasswordHint } from './password-policy';
import { PasswordGuidance } from './password-guidance';
import { SignupConfirmation } from './signup-confirmation';
import { useEmailAuth } from './use-email-auth';
import { emailCodeLength } from './email-verification';

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const google = useGoogleLogin();
  const { colors } = useAppTheme();
  const signingUp = mode === 'sign-up';
  const auth = useEmailAuth(signingUp, google.busy);
  const passwordInput = useRef<TextInput>(null);
  const [showPassword, setShowPassword] = useState(false);
  const busy = !!auth.operation || google.busy;
  useFocusEffect(
    useCallback(() => {
      if (!auth.confirmationEmail) return;
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!busy) auth.changeEmail();
        return true;
      });
      return () => back.remove();
    }, [auth, busy]),
  );
  return (
    <Screen scrollResetKey={auth.confirmationEmail ? 'verify' : mode}>
      <View style={styles.layout}>
        <BrandLogo compact />
        <View style={styles.main}>
          <View style={styles.intro}>
            <AppText variant="title">
              {auth.confirmationEmail
                ? emailCodeLength
                  ? 'Verify your email'
                  : 'Check your inbox'
                : signingUp
                  ? 'Create your account'
                  : 'Welcome back'}
            </AppText>
            {!auth.confirmationEmail && (
              <AppText variant="subtitle">
                {signingUp
                  ? 'A new way to see the words around you.'
                  : 'Your next words are waiting.'}
              </AppText>
            )}
          </View>
          {auth.confirmationEmail ? (
            <SignupConfirmation auth={auth} googleBusy={google.busy} />
          ) : (
            <View style={styles.form}>
              <FormField
                label="Email"
                value={auth.email}
                onChangeText={auth.editEmail}
                error={auth.fieldErrors.email}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
              />
              <View style={styles.password}>
                <FormField
                  ref={passwordInput}
                  label="Password"
                  value={auth.password}
                  onChangeText={auth.editPassword}
                  error={auth.fieldErrors.password}
                  hint={signingUp ? signupPasswordHint : undefined}
                  editable={!busy}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={signingUp ? 'new-password' : 'current-password'}
                  textContentType={signingUp ? 'newPassword' : 'password'}
                  onSubmitEditing={() => void auth.submit()}
                  returnKeyType="go"
                  endAdornment={
                    <IconButton
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={busy}
                      onPress={() => setShowPassword((value) => !value)}
                    />
                  }
                />
                {signingUp && !auth.fieldErrors.password && (
                  <PasswordGuidance password={auth.password} />
                )}
              </View>
              {!signingUp && (
                <Link href="/forgot-password" asChild>
                  <Pressable
                    disabled={busy}
                    accessibilityRole="link"
                    accessibilityState={{ disabled: busy }}
                    style={{ minHeight: 48, justifyContent: 'center' }}
                  >
                    <AppText style={{ color: colors.brandText }}>Forgot password?</AppText>
                  </Pressable>
                </Link>
              )}
              {!!auth.error && (
                <AppText
                  style={{ color: colors.error }}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {auth.error}
                </AppText>
              )}
              <View style={styles.primary}>
                <Button
                  label={signingUp ? 'Create account' : 'Sign in'}
                  loading={auth.operation === 'submit'}
                  disabled={google.busy}
                  onPress={() => void auth.submit()}
                />
              </View>
            </View>
          )}
          <View style={styles.alternatives}>
            <View style={styles.divider}>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <AppText variant="caption">or</AppText>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </View>
            <GoogleButton disabled={!!auth.operation} />
          </View>
        </View>
        {!auth.confirmationEmail && (
          <Link replace href={signingUp ? '/sign-in' : '/sign-up'} asChild>
            <Pressable
              disabled={busy}
              accessibilityRole="link"
              accessibilityState={{ disabled: busy }}
              style={styles.accountLink}
            >
              <AppText style={styles.center}>
                {signingUp ? 'Already have an account? ' : 'New to Langtify? '}
                <AppText style={{ color: colors.brandText, fontWeight: '600' }}>
                  {signingUp ? 'Sign in' : 'Create account'}
                </AppText>
              </AppText>
            </Pressable>
          </Link>
        )}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  layout: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 36,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingVertical: 8,
  },
  main: { gap: 28 },
  intro: { gap: 8 },
  form: { gap: 20 },
  password: { gap: 6 },
  primary: { paddingTop: 4 },
  alternatives: { gap: 20 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  accountLink: { paddingVertical: 14, minHeight: 48 },
  center: { textAlign: 'center' },
});
