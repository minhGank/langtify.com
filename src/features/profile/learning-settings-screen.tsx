import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { TimezoneField } from '@/features/onboarding/timezone-field';
import {
  cefrOptions,
  validateOnboarding,
  type OnboardingErrors,
  type OnboardingInput,
} from '@/features/onboarding/validation';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import type { SafetyIdentity } from '@/features/safety/model';
import { useAppTheme } from '@/hooks/use-app-theme';
import { invalidateServerData } from '@/lib/server-cache';
import type { Account } from '@/services/account';
import { socialGateway } from '@/services/social';

export function LearningSettingsScreen() {
  const { status, account, session, refreshAccount } = useAuth();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  if (status !== 'ready' || !identity || !account?.learning) return null;
  return (
    <LearningSettings
      key={`${identity.userId}:${identity.token}`}
      account={account}
      identity={identity}
      saved={refreshAccount}
    />
  );
}
function LearningSettings({
  account,
  identity,
  saved,
}: {
  account: Account;
  identity: SafetyIdentity;
  saved: () => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const languages = account.languages.filter((l) => l.is_active);
  const [draft, setDraft] = useState<OnboardingInput>({
    username: account.profile?.username ?? '',
    referenceLanguageId: account.learning?.reference_language_id ?? '',
    targetLanguageId: account.learning?.target_language_id ?? '',
    cefrLevel: account.learning?.cefr_level ?? '',
    timezone: account.learning?.timezone ?? '',
  });
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const task = useSafetyTask(() => {});
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const update = (key: keyof OnboardingInput, value: string) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setErrors((old) => ({ ...old, [key]: undefined }));
  };
  const options = languages.map((l) => ({ value: l.id, label: l.name }));
  return (
    <Screen>
      <IconButton name="chevron-back" label="Back to Profile" onPress={close} />
      <AppText variant="title">Learning preferences</AppText>
      <AppText variant="caption">
        Saved challenges keep their original words and languages. New challenges use your updated
        setup. Your timezone determines your local learning day.
      </AppText>
      <ChoiceField
        label="Reference language"
        value={draft.referenceLanguageId}
        options={options}
        disabled={task.busy}
        error={errors.referenceLanguageId}
        onChange={(value) => update('referenceLanguageId', value)}
      />
      <ChoiceField
        label="Target language"
        value={draft.targetLanguageId}
        options={options}
        disabled={task.busy}
        error={errors.targetLanguageId}
        onChange={(value) => update('targetLanguageId', value)}
      />
      <ChoiceField
        label="Your current level"
        value={draft.cefrLevel}
        options={cefrOptions}
        disabled={task.busy}
        error={errors.cefrLevel}
        onChange={(value) => update('cefrLevel', value)}
      />
      <TimezoneField
        value={draft.timezone}
        onChange={(value) => update('timezone', value)}
        disabled={task.busy}
        error={errors.timezone}
      />
      <Button
        label="Save learning preferences"
        loading={task.busy}
        onPress={() => {
          const validation = validateOnboarding(
            draft,
            languages.map((l) => l.id),
          );
          setErrors(validation);
          if (Object.keys(validation).length) return;
          void task.run(
            async (signal) => {
              await gateway.updateLearning(draft, signal);
              if (!signal.aborted) await saved();
            },
            () => {
              invalidateServerData(
                ['challenge', 'progress', 'discover', 'comments', 'public-profile'],
                { discard: true },
              );
              close();
            },
          );
        }}
      />
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {task.error}
        </AppText>
      )}
    </Screen>
  );
}
