import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { MotionView } from '@/components/ui/motion-view';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { friendlyError } from '@/features/auth/errors';
import { SignOutButton } from '@/features/auth/sign-out-button';
import {
  detectTimezone,
  validateOnboarding,
  type OnboardingErrors,
  type OnboardingInput,
} from '@/features/onboarding/validation';
import { completeOnboarding } from '@/services/account';
import { useAppTheme } from '@/hooks/use-app-theme';
import { OnboardingStep, onboardingSteps } from './onboarding-steps';

export function OnboardingScreen() {
  const { session } = useAuth();
  // Account changes must discard the previous draft even if React batches away
  // the intermediate loading route. Token refresh for the same user retains it.
  return <OnboardingForm key={session?.user.id ?? 'signed-out'} />;
}

function OnboardingForm() {
  const { colors } = useAppTheme();
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
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const currentStep = onboardingSteps[stepIndex] ?? onboardingSteps[0];
  const lastStep = stepIndex === onboardingSteps.length - 1;
  const changeStep = useCallback(
    (nextIndex: number) => {
      if (submitting.current || nextIndex < 0 || nextIndex >= onboardingSteps.length) return;
      Keyboard.dismiss();
      setDirection(nextIndex < stepIndex ? -1 : 1);
      setStepIndex(nextIndex);
      const nextStep = onboardingSteps[nextIndex];
      if (nextStep) {
        AccessibilityInfo.announceForAccessibility(
          `Step ${nextIndex + 1} of ${onboardingSteps.length}. ${nextStep.title}`,
        );
      }
    },
    [stepIndex],
  );
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting.current) return true;
      if (stepIndex === 0) return false;
      changeStep(stepIndex - 1);
      return true;
    });
    return () => subscription.remove();
  }, [changeStep, stepIndex]);

  function update(field: keyof OnboardingInput, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError('');
  }
  function next() {
    if (submitting.current || languages.length < 2 || lastStep) return;
    const validation = validateOnboarding(
      input,
      languages.map((language) => language.id),
    );
    const fieldError = validation[currentStep.field];
    setErrors((previous) => ({ ...previous, [currentStep.field]: fieldError }));
    if (!fieldError) changeStep(stepIndex + 1);
  }
  async function submit() {
    if (submitting.current || !session) return;
    const validation = validateOnboarding(
      input,
      languages.map((language) => language.id),
    );
    setErrors(validation);
    setError('');
    const invalidStep = onboardingSteps.findIndex((step) => validation[step.field]);
    if (invalidStep >= 0) {
      changeStep(invalidStep);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await completeOnboarding(input, session.access_token);
      if (mounted.current) reload(); // Never unlock tabs from an optimistic/local completion flag.
    } catch (cause) {
      if (mounted.current) {
        setError(
          friendlyError(cause, 'We couldn’t save your setup. Check your connection and try again.'),
        );
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          cause.code === '23505'
        ) {
          // This exact backend error already means a username collision. Preserve
          // the draft and make its correction reachable without restarting setup.
          submitting.current = false;
          changeStep(onboardingSteps.findIndex((step) => step.field === 'username'));
        }
      }
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
    <Screen scrollResetKey={stepIndex}>
      <View style={styles.brand}>
        <BrandLogo />
      </View>
      <View style={styles.progressHeader}>
        {stepIndex > 0 ? (
          <IconButton
            name="arrow-back"
            label="Previous setup step"
            onPress={() => changeStep(stepIndex - 1)}
            disabled={busy}
          />
        ) : (
          <View style={styles.backSpace} />
        )}
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Setup progress"
          accessibilityValue={{
            min: 1,
            max: onboardingSteps.length,
            now: stepIndex + 1,
            text: `Step ${stepIndex + 1} of ${onboardingSteps.length}`,
          }}
          style={styles.progress}
        >
          <AppText variant="caption">
            Step {stepIndex + 1} of {onboardingSteps.length}
          </AppText>
          <View style={styles.track}>
            {onboardingSteps.map((step, index) => (
              <View
                key={step.field}
                style={[
                  styles.segment,
                  { backgroundColor: index <= stepIndex ? colors.brandPrimary : colors.border },
                ]}
              />
            ))}
          </View>
        </View>
      </View>
      <MotionView trigger={stepIndex} kind="step" direction={direction} style={styles.step}>
        <View
          key={currentStep.field}
          style={styles.step}
          onAccessibilityEscape={() => changeStep(stepIndex - 1)}
        >
          <View style={styles.intro}>
            <AppText variant="title">{currentStep.title}</AppText>
            <AppText style={{ color: colors.textSecondary }}>{currentStep.description}</AppText>
          </View>
          {languages.length < 2 ? (
            <>
              <AppText style={{ color: colors.error }} accessibilityRole="alert">
                We couldn’t load the languages. Try again.
              </AppText>
              <Button variant="secondary" label="Reload languages" onPress={reload} />
            </>
          ) : (
            <OnboardingStep
              field={currentStep.field}
              input={input}
              errors={errors}
              options={options}
              busy={busy}
              onChange={update}
              onNext={next}
            />
          )}
          {error && (
            <AppText
              style={{ color: colors.error }}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </AppText>
          )}
        </View>
      </MotionView>
      <View style={styles.actions}>
        <Button
          label={lastStep ? 'Finish setup' : 'Continue'}
          loading={busy}
          disabled={languages.length < 2}
          onPress={lastStep ? () => void submit() : next}
        />
        {!busy && <SignOutButton />}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  brand: { alignItems: 'center', paddingTop: 8 },
  intro: { gap: 12 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backSpace: { width: 48, height: 48 },
  progress: { flex: 1, gap: 8 },
  track: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  step: { gap: 28, flexGrow: 1 },
  actions: { gap: 8 },
});
