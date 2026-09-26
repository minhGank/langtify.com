import { GoogleButton, useGoogleLogin } from '@/features/auth/oauth/google-button';
import { authMutation } from '@/features/auth/oauth/runtime';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { authErrorCode, friendlyError, isObscuredSignup } from '@/features/auth/errors';
import {
  passwordRejection,
  signupPasswordHint,
  validateSignupPassword,
} from '@/features/auth/password-policy';
import { requireSupabase } from '@/lib/supabase';
import { useAppTheme } from '@/hooks/use-app-theme';
import { PasswordGuidance } from './password-guidance';
import { SignupConfirmation } from './signup-confirmation';

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const google = useGoogleLogin();
  const { colors } = useAppTheme();
  const signingUp = mode === 'sign-up';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [requestedAgain, setRequestedAgain] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const title = confirmationEmail ? 'Check your inbox' : signingUp ? 'Create account' : 'Sign in';
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function submit() {
    if (submitting.current || google.busy) return;
    setError('');
    setCanResend(false);
    const cleanEmail = email.trim();
    const validation = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
        ? undefined
        : 'Enter a valid email address.',
      password: signingUp
        ? validateSignupPassword(password)
        : password
          ? undefined
          : 'Enter your password.',
    };
    setFieldErrors(validation);
    if (validation.email || validation.password) return;
    submitting.current = true;
    setBusy(true);
    try {
      const auth = requireSupabase().auth;
      if (signingUp) {
        const { data, error: signupError } = await authMutation(() =>
          auth.signUp({ email: cleanEmail, password }),
        );
        if (signupError) throw signupError;
        if (mounted.current && !data.session) {
          setConfirmationEmail(cleanEmail);
          setRequestedAgain(false);
          setPassword('');
        }
      } else {
        const { error: signinError } = await authMutation(() =>
          auth.signInWithPassword({ email: cleanEmail, password }),
        );
        if (signinError) throw signinError;
      }
    } catch (cause) {
      if (!mounted.current) return;
      if (signingUp && isObscuredSignup(cause)) {
        setConfirmationEmail(cleanEmail);
        setRequestedAgain(false);
        setPassword('');
        return;
      }
      setCanResend(authErrorCode(cause) === 'email_not_confirmed');
      const passwordError = passwordRejection(cause);
      if (passwordError) setFieldErrors((previous) => ({ ...previous, password: passwordError }));
      else {
        setError(friendlyError(cause, 'We couldn’t connect. Check your connection and try again.'));
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function resend() {
    if (submitting.current || google.busy || (!confirmationEmail && !canResend)) return;
    const address = confirmationEmail ?? email.trim();
    submitting.current = true;
    setBusy(true);
    setError('');
    setRequestedAgain(false);
    try {
      const { error: resendError } = await authMutation(() =>
        requireSupabase().auth.resend({ type: 'signup', email: address }),
      );
      // Resend may deliberately return an indistinguishable no-op for accounts
      // that do not need confirmation. Never inspect identities or user metadata.
      if (
        resendError &&
        !isObscuredSignup(resendError) &&
        !['email_already_confirmed', 'user_not_found'].includes(String(authErrorCode(resendError)))
      )
        throw resendError;
      if (mounted.current) setRequestedAgain(true);
    } catch (cause) {
      if (mounted.current)
        setError(
          friendlyError(cause, 'We couldn’t request another link. Try again in a few minutes.'),
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const errorNotice = error ? (
    <AppText
      style={{ color: colors.error }}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {error}
    </AppText>
  ) : null;
  return (
    <Screen>
      <View style={styles.intro}>
        <BrandLogo />
        <AppText variant="title">{title}</AppText>
      </View>
      <GoogleButton disabled={busy} />
      {confirmationEmail && errorNotice}
      {confirmationEmail ? (
        <SignupConfirmation
          email={confirmationEmail}
          busy={busy || google.busy}
          requestedAgain={requestedAgain}
          resend={() => void resend()}
          changeEmail={() => {
            setConfirmationEmail(null);
            setRequestedAgain(false);
            setCanResend(false);
            setError('');
            setFieldErrors({});
          }}
        />
      ) : (
        <>
          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
            <AppText variant="caption" style={{ color: colors.textSecondary }}>
              or use email
            </AppText>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
          </View>
          <FormField
            label="Email"
            required
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors((previous) => ({ ...previous, email: undefined }));
              setError('');
              setCanResend(false);
              setRequestedAgain(false);
            }}
            error={fieldErrors.email}
            editable={!busy && !google.busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <FormField
            label="Password"
            required
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((previous) => ({ ...previous, password: undefined }));
              setError('');
            }}
            error={fieldErrors.password}
            hint={signingUp ? signupPasswordHint : undefined}
            editable={!busy && !google.busy}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            textContentType={signingUp ? 'newPassword' : 'password'}
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />
          {signingUp && !fieldErrors.password && <PasswordGuidance password={password} />}
          {errorNotice}
          {canResend && (
            <Button
              label="Resend verification"
              variant="secondary"
              loading={busy}
              disabled={google.busy}
              onPress={() => void resend()}
            />
          )}
          {requestedAgain && (
            <AppText accessibilityLiveRegion="polite">
              If verification is still needed, look for a new link in your inbox.
            </AppText>
          )}
          <Button
            label={signingUp ? 'Create account' : 'Sign in'}
            loading={busy}
            disabled={google.busy}
            onPress={() => void submit()}
          />
          {!busy && !google.busy && (
            <Link href={signingUp ? '/sign-in' : '/sign-up'} style={styles.accountLink}>
              <AppText style={{ color: colors.brandText }}>
                {signingUp ? 'Already have an account? Sign in' : 'New to Langtify? Create account'}
              </AppText>
            </Link>
          )}
          {!signingUp && (
            <AppText variant="caption">Joined with Google? Continue with Google above.</AppText>
          )}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  intro: { gap: 10, paddingTop: 12, paddingBottom: 8 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  accountLink: { paddingVertical: 14, textAlign: 'center' },
});
