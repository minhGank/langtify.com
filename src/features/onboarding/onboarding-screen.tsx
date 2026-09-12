import { useEffect, useRef, useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { friendlyError } from '@/features/auth/errors';
import { SignOutButton } from '@/features/auth/sign-out-button';
import {
  cefrOptions,
  detectTimezone,
  normalizeUsername,
  validateOnboarding,
  type OnboardingErrors,
  type OnboardingInput,
} from '@/features/onboarding/validation';
import { completeOnboarding } from '@/services/account';

export function OnboardingScreen() {
  const { session } = useAuth();
  // Account changes must discard the previous draft even if React batches away
  // the intermediate loading route. Token refresh for the same user retains it.
  return <OnboardingForm key={session?.user.id ?? 'signed-out'} />;
}

function OnboardingForm() {
  const { account, session, reload } = useAuth();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const languages = account?.languages.filter((language) => language.is_active) ?? [];
  const [input, setInput] = useState<OnboardingInput>(() => ({
    username: account?.profile?.username ?? '',
    referenceLanguageId:
      account?.learning?.reference_language_id ??
      languages.find((language) => language.code === 'en')?.id ??
      '',
    targetLanguageId:
      account?.learning?.target_language_id ??
      languages.find((language) => language.code === 'fr')?.id ??
      '',
    cefrLevel: account?.learning?.cefr_level ?? '',
    timezone: account?.learning?.timezone ?? detectTimezone(),
  }));
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  function update(field: keyof OnboardingInput, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }
  async function submit() {
    if (submitting.current || !session) return;
    const validation = validateOnboarding(
      input,
      languages.map((language) => language.id),
    );
    setErrors(validation);
    setError('');
    if (Object.keys(validation).length > 0) return;
    submitting.current = true;
    setBusy(true);
    try {
      await completeOnboarding(input, session.access_token);
      if (mounted.current) reload(); // Never unlock tabs from an optimistic/local completion flag.
    } catch (cause) {
      if (mounted.current)
        setError(
          friendlyError(
            cause,
            'We could not save your setup. Check your connection and try again. Your account is safe to retry.',
          ),
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const options = languages.map((language) => ({
    value: language.id,
    label: `${language.name} (${language.native_name})`,
  }));
  return (
    <Screen>
      <AppText variant="title">Welcome to Langtify</AppText>
      <AppText>Set up your learning profile.</AppText>
      <FormField
        label="Username"
        value={input.username}
        onChangeText={(value) => update('username', value)}
        onBlur={() => update('username', normalizeUsername(input.username))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        maxLength={30}
        editable={!busy}
        error={errors.username}
        hint="3–30 letters, numbers or underscores. Usernames are stored in lowercase."
      />
      {languages.length < 2 ? (
        <>
          <AppText accessibilityRole="alert">
            Learning languages are unavailable. Please try again shortly.
          </AppText>
          <Button label="Reload languages" onPress={reload} />
        </>
      ) : (
        <>
          <ChoiceField
            label="Reference language"
            value={input.referenceLanguageId}
            options={options}
            disabled={busy}
            onChange={(value) => update('referenceLanguageId', value)}
            error={errors.referenceLanguageId}
          />
          <AppText>This language will explain translations.</AppText>
          <ChoiceField
            label="Target language"
            value={input.targetLanguageId}
            options={options}
            disabled={busy}
            onChange={(value) => update('targetLanguageId', value)}
            error={errors.targetLanguageId}
          />
        </>
      )}
      <ChoiceField
        label="Your current level"
        value={input.cefrLevel}
        disabled={busy}
        options={cefrOptions.map((option) => ({
          value: option.value,
          label: `${option.value} — ${option.label}`,
        }))}
        onChange={(value) => update('cefrLevel', value)}
        error={errors.cefrLevel}
      />
      <FormField
        label="Timezone"
        value={input.timezone}
        onChangeText={(value) => update('timezone', value)}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        error={errors.timezone}
        hint="Detected from your device when available. Check this timezone before saving; it will be stored with your profile."
      />
      {error && (
        <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
      <Button
        label="Finish setup"
        loading={busy}
        disabled={languages.length < 2}
        onPress={() => void submit()}
      />
      {!busy && <SignOutButton />}
    </Screen>
  );
}
