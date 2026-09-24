import { GoogleButton, useGoogleLogin } from '@/features/auth/oauth/google-button';
import { authMutation } from '@/features/auth/oauth/runtime';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { friendlyError } from '@/features/auth/errors';
import {
  passwordRejection,
  signupPasswordHint,
  validateSignupPassword,
} from '@/features/auth/password-policy';
import { requireSupabase } from '@/lib/supabase';
import { useAppTheme } from '@/hooks/use-app-theme';

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const google = useGoogleLogin();
  const { colors } = useAppTheme();
  const signingUp = mode === 'sign-up';
  const title = signingUp ? 'Create your account' : 'Sign in';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function submit() {
    if (submitting.current || google.busy) return;
    setError('');
    setMessage('');
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
        if (!data.session) {
          setMessage(
            'If this address can be registered, a confirmation email is on its way. Confirm your email, then return to sign in.',
          );
          setPassword('');
        }
      } else {
        const { error: signinError } = await authMutation(() =>
          auth.signInWithPassword({ email: cleanEmail, password }),
        );
        if (signinError) throw signinError;
      }
    } catch (cause) {
      const passwordError = passwordRejection(cause);
      if (passwordError) setFieldErrors((previous) => ({ ...previous, password: passwordError }));
      else {
        setError(
          friendlyError(cause, 'Unable to connect right now. Check your connection and try again.'),
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <View style={styles.intro}>
        <BrandLogo />
        <AppText variant="title">{title}</AppText>
        <AppText style={{ color: colors.textSecondary }}>
          {signingUp ? 'A new way to see the words you learn.' : 'Your next discovery is waiting.'}
        </AppText>
      </View>
      <GoogleButton disabled={busy} />
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
      {error && (
        <AppText
          style={{ color: colors.error }}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </AppText>
      )}
      {message && (
        <AppText style={{ color: colors.success }} accessibilityLiveRegion="polite">
          {message}
        </AppText>
      )}
      <Button
        label={signingUp ? 'Sign up' : 'Sign in'}
        loading={busy}
        disabled={google.busy}
        onPress={() => void submit()}
      />
      {!busy && !google.busy && (
        <Link href={signingUp ? '/sign-in' : '/sign-up'} style={styles.accountLink}>
          <AppText style={{ color: colors.brandText }}>
            {signingUp ? 'Already have an account? Sign in' : 'New to Langtify? Sign up'}
          </AppText>
        </Link>
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
