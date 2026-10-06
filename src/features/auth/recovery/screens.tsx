import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { useAppTheme } from '@/hooks/use-app-theme';
import { PasswordGuidance } from '../password-guidance';
import { signupPasswordHint, validateSignupPassword } from '../password-policy';
import { recovery, requestPasswordReset, updateRecoveryPassword } from '../oauth/runtime';

export function RecoveryScreen({ mode }: { mode: 'request' | 'password' }) {
  const state = useSyncExternalStore(recovery.subscribe, recovery.snapshot, recovery.snapshot);
  const { colors } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const lifetime = useRef(0);
  useFocusEffect(
    useCallback(() => {
      lifetime.current++;
      return () => {
        lifetime.current++;
        setPassword('');
        setConfirmation('');
      };
    }, []),
  );
  const request = mode === 'request';
  const nativeOnly = request && Platform.OS === 'web';
  const complete = state.phase === 'success';
  const failed = state.phase === 'failed';
  const sent = request && state.phase === 'sent';
  async function submit() {
    if (lock.current || nativeOnly) return;
    const validation = request
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? undefined
        : 'Enter a valid email address.'
      : (validateSignupPassword(password) ??
        (password !== confirmation ? 'Passwords don’t match.' : undefined));
    setError(validation ?? '');
    if (validation) return;
    lock.current = true;
    setBusy(true);
    const generation = lifetime.current;
    try {
      if (request) await requestPasswordReset(email.trim());
      else await updateRecoveryPassword(password);
    } catch {
      if (generation === lifetime.current)
        setError('We couldn’t complete this request. Try again.');
    } finally {
      lock.current = false;
      if (generation === lifetime.current) {
        setBusy(false);
        if (!request) {
          setPassword('');
          setConfirmation('');
        }
      }
    }
  }
  async function leave() {
    if (lock.current) return;
    await recovery.cancel();
    router.replace('/sign-in');
  }
  return (
    <Screen>
      <View
        style={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: 24,
          maxWidth: 440,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <BrandLogo compact />
        <AppText variant="title">
          {complete ? 'Password updated' : request ? 'Reset password' : 'Set new password'}
        </AppText>
        {nativeOnly && (
          <AppText>Open the installed Langtify app to request a password reset link.</AppText>
        )}
        {!nativeOnly && !complete && !failed && !sent && (
          <AppText variant="subtitle">
            {request
              ? 'Enter your email to request a reset link.'
              : 'Choose a new password for your account.'}
          </AppText>
        )}
        {!nativeOnly &&
          !complete &&
          !failed &&
          !sent &&
          (request ? (
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
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          ) : (
            <>
              <FormField
                label="New password"
                value={password}
                onChangeText={setPassword}
                editable={!busy}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                hint={signupPasswordHint}
                endAdornment={
                  <IconButton
                    name={show ? 'eye-off-outline' : 'eye-outline'}
                    label={show ? 'Hide password' : 'Show password'}
                    disabled={busy}
                    onPress={() => setShow(!show)}
                  />
                }
              />
              <PasswordGuidance password={password} />
              <FormField
                label="Confirm new password"
                value={confirmation}
                onChangeText={setConfirmation}
                editable={!busy}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            </>
          ))}
        {!!(error || state.message) && (
          <AppText
            accessibilityRole={error || state.phase === 'error' || failed ? 'alert' : undefined}
            accessibilityLiveRegion="polite"
            style={error || state.phase === 'error' || failed ? { color: colors.error } : undefined}
          >
            {error || state.message}
          </AppText>
        )}
        {!complete && !failed && !sent && (
          <Button
            label={request ? 'Send reset link' : 'Update password'}
            loading={busy}
            disabled={nativeOnly || (!request && state.phase !== 'ready')}
            onPress={() => void submit()}
          />
        )}
        {sent && (
          <AppText variant="caption">
            If no email arrives, return to Sign in and request another link later. Use the latest
            email.
          </AppText>
        )}
        <Button
          label={complete ? 'Sign in' : 'Back to sign in'}
          variant="secondary"
          disabled={busy}
          onPress={() => void leave().catch(() => setError('Please try again.'))}
        />
      </View>
    </Screen>
  );
}
