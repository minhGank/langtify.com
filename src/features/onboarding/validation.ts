export const cefrOptions = [
  { value: 'A1', label: 'Beginner' },
  { value: 'A2', label: 'Elementary' },
  { value: 'B1', label: 'Intermediate' },
  { value: 'B2', label: 'Upper intermediate' },
  { value: 'C1', label: 'Advanced' },
  { value: 'C2', label: 'Proficient' },
] as const;
export type CefrLevel = (typeof cefrOptions)[number]['value'];
export function isCefrLevel(value: string): value is CefrLevel {
  return cefrOptions.some((option) => option.value === value);
}
export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
export function isValidTimezone(value: string) {
  if (value !== 'UTC' && !value.includes('/')) return false;
  if (value.startsWith('posix/') || value.startsWith('right/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function detectTimezone() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(timezone) ? timezone : '';
  } catch {
    return '';
  }
}
export type OnboardingInput = {
  username: string;
  referenceLanguageId: string;
  targetLanguageId: string;
  cefrLevel: string;
  timezone: string;
};
export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>;
export function validateOnboarding(
  input: OnboardingInput,
  activeLanguageIds: readonly string[],
): OnboardingErrors {
  const errors: OnboardingErrors = {};
  if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(normalizeUsername(input.username))) {
    errors.username = 'Use 3–30 letters, numbers or underscores, starting with a letter or number.';
  }
  if (!activeLanguageIds.includes(input.referenceLanguageId)) {
    errors.referenceLanguageId = 'Choose your translation language.';
  }
  if (!activeLanguageIds.includes(input.targetLanguageId)) {
    errors.targetLanguageId = 'Choose the language you’re learning.';
  } else if (input.referenceLanguageId === input.targetLanguageId) {
    errors.targetLanguageId = 'Choose two different languages.';
  }
  if (!isCefrLevel(input.cefrLevel)) errors.cefrLevel = 'Choose your current level.';
  if (!isValidTimezone(input.timezone.trim())) {
    errors.timezone = 'Choose your timezone from the list.';
  }
  return errors;
}
