import { Link } from 'expo-router';
import { useRef, useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { friendlyError } from '@/features/auth/errors';
import { requireSupabase } from '@/lib/supabase';

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signingUp = mode === 'sign-up';
  const title = signingUp ? 'Create your account' : 'Sign in';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit() {
    if (submitting.current) return;
    setError('');
    setMessage('');
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !password) {
      setError('Enter a valid email address and your password.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const auth = requireSupabase().auth;
      if (signingUp) {
        const { data, error: signupError } = await auth.signUp({ email: cleanEmail, password });
        if (signupError) throw signupError;
        if (!data.session) {
          setMessage(
            'If this address can be registered, a confirmation email is on its way. Check your inbox, confirm your email, then return here to sign in. Already registered? Try signing in.',
          );
          setPassword('');
        }
      } else {
        const { error: signinError } = await auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signinError) throw signinError;
      }
    } catch (cause) {
      setError(
        friendlyError(cause, 'Unable to connect right now. Check your connection and try again.'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <AppText>Langtify</AppText>
      <AppText variant="title">{title}</AppText>
      <FormField
        label="Email"
        value={email}
        onChangeText={setEmail}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <FormField
        label="Password"
        value={password}
        onChangeText={setPassword}
        editable={!busy}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={signingUp ? 'new-password' : 'current-password'}
        textContentType={signingUp ? 'newPassword' : 'password'}
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />
      {error && (
        <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
      {message && <AppText accessibilityLiveRegion="polite">{message}</AppText>}
      <Button
        label={signingUp ? 'Sign up' : 'Sign in'}
        loading={busy}
        onPress={() => void submit()}
      />
      {!busy && (
        <Link href={signingUp ? '/sign-in' : '/sign-up'} style={{ paddingVertical: 12 }}>
          <AppText>
            {signingUp ? 'Already have an account? Sign in' : 'New to Langtify? Sign up'}
          </AppText>
        </Link>
      )}
    </Screen>
  );
}
