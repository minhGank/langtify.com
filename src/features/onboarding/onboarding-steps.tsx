import { ChoiceField } from '@/components/ui/choice-field';
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
    description: 'First, choose the language you use for translations.',
  },
  {
    field: 'targetLanguageId',
    title: 'What will you explore?',
    description: 'Choose the language you want to learn, one photo at a time.',
  },
  {
    field: 'cefrLevel',
    title: 'Find your starting point',
    description: 'Choose the level that feels closest to where you are today.',
  },
  {
    field: 'username',
    title: 'What should we call you?',
    description: 'Choose a username other learners can find.',
  },
  {
    field: 'timezone',
    title: 'Your day, your rhythm',
    description: 'Confirm your timezone so daily words and streaks follow your day.',
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
  options: readonly { value: string; label: string }[];
  busy: boolean;
  onChange: (field: keyof OnboardingInput, value: string) => void;
  onNext: () => void;
}) {
  switch (field) {
    case 'referenceLanguageId':
    case 'targetLanguageId':
      return (
        <ChoiceField
          label={field === 'referenceLanguageId' ? 'Translation language' : 'Learning language'}
          required
          value={input[field]}
          options={options}
          disabled={busy}
          onChange={(value) => onChange(field, value)}
          error={errors[field]}
        />
      );
    case 'cefrLevel':
      return (
        <ChoiceField
          label="Your current level"
          required
          value={input.cefrLevel}
          disabled={busy}
          options={cefrOptions.map((option) => ({
            value: option.value,
            label: `${option.value} — ${option.label}`,
          }))}
          onChange={(value) => onChange('cefrLevel', value)}
          error={errors.cefrLevel}
        />
      );
    case 'username':
      return (
        <FormField
          label="Username"
          required
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
          value={input.timezone}
          onChange={(value) => onChange('timezone', value)}
          disabled={busy}
          error={errors.timezone}
        />
      );
  }
}
