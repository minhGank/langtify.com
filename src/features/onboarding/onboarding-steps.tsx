import { SetupChoices, type SetupOption } from './setup-choices';
import { FormField } from '@/components/ui/form-field';
import { TimezoneField } from './timezone-field';
import {
  cefrOptions,
  normalizeUsername,
  type OnboardingErrors,
  type OnboardingInput,
} from './validation';

export const onboardingSteps = [
  {
    field: 'referenceLanguageId',
    title: 'Make it yours',
    description: 'Which language do you know best? We’ll use it for translations.',
  },
  {
    field: 'targetLanguageId',
    title: 'What will you explore?',
    description: 'Pick the language you want to learn.',
  },
  {
    field: 'cefrLevel',
    title: 'Find your starting point',
    description: 'Choose what feels closest. You can change it later.',
  },
  {
    field: 'username',
    title: 'Choose your username',
    description: 'How other learners will find you.',
  },
  {
    field: 'timezone',
    title: 'Your day, your rhythm',
    description: 'Your timezone keeps daily words and streaks on your schedule.',
  },
] as const;

export function OnboardingStep({
  field,
  input,
  errors,
  options,
  busy,
  onChange,
  onNext,
}: {
  field: keyof OnboardingInput;
  input: OnboardingInput;
  errors: OnboardingErrors;
  options: readonly SetupOption[];
  busy: boolean;
  onChange: (field: keyof OnboardingInput, value: string) => void;
  onNext: () => void;
}) {
  switch (field) {
    case 'referenceLanguageId':
    case 'targetLanguageId':
      return (
        <SetupChoices
          label={field === 'referenceLanguageId' ? 'Translation language' : 'Learning language'}
          value={input[field]}
          options={options}
          disabled={busy}
          onChange={(value) => onChange(field, value)}
          error={errors[field]}
        />
      );
    case 'cefrLevel':
      return (
        <SetupChoices
          label="Your current level"
          value={input.cefrLevel}
          disabled={busy}
          options={cefrOptions.map((option) => ({
            value: option.value,
            label: option.label,
            badge: option.value,
            detail: levelDescriptions[option.value],
          }))}
          onChange={(value) => onChange('cefrLevel', value)}
          error={errors.cefrLevel}
        />
      );
    case 'username':
      return (
        <FormField
          label="Username"
          style={{ fontSize: 22, minHeight: 64 }}
          value={input.username}
          onChangeText={(value) => onChange('username', value)}
          onBlur={() => onChange('username', normalizeUsername(input.username))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          autoFocus
          returnKeyType="next"
          onSubmitEditing={onNext}
          maxLength={30}
          editable={!busy}
          error={errors.username}
          hint="3–30 letters, numbers or underscores."
        />
      );
    case 'timezone':
      return (
        <TimezoneField
          presentation="setup"
          value={input.timezone}
          onChange={(value) => onChange('timezone', value)}
          disabled={busy}
          error={errors.timezone}
        />
      );
  }
}

const levelDescriptions = {
  A1: 'Familiar words and simple phrases',
  A2: 'Everyday situations and short conversations',
  B1: 'Familiar topics and personal experiences',
  B2: 'Detailed ideas and a wider range of topics',
  C1: 'Complex topics and flexible expression',
  C2: 'Subtle meanings and precise expression',
} as const;
