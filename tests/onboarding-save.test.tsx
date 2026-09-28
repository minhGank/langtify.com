import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Appearance, BackHandler, Keyboard, KeyboardAvoidingView, ScrollView } from 'react-native';

import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { completeOnboarding } from '@/services/account';
import { feedback } from '@/lib/haptics';
import { palette } from '@/lib/theme';
import { makeAccount, makeSession } from './fixtures';

const mockReload = jest.fn();
let mockAccount = makeAccount();
let mockSession = makeSession();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ account: mockAccount, session: mockSession, reload: mockReload }),
}));
jest.mock('@/services/account', () => ({ completeOnboarding: jest.fn() }));
jest.mock('@/lib/haptics', () => ({
  feedback: { selection: jest.fn(), confirm: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
const save = jest.mocked(completeOnboarding);
function continueSetup(count = 1) {
  for (let step = 0; step < count; step++) {
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = makeAccount();
  mockSession = makeSession();
});
it('preserves the setup form and keeps routes locked after a failed transaction', async () => {
  save.mockRejectedValueOnce({ code: '23505' });
  render(<OnboardingScreen />);
  continueSetup(4);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  expect(await screen.findByText('That username is taken. Try another.')).toBeVisible();
  expect(mockReload).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('learner');
  save.mockResolvedValueOnce(undefined);
  fireEvent.changeText(screen.getByLabelText('Username'), 'another_learner');
  continueSetup();
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
});
it('rejects invalid fields before attempting to save', () => {
  render(<OnboardingScreen />);
  continueSetup(3);
  fireEvent.changeText(screen.getByLabelText('Username'), 'bad name');
  continueSetup();
  expect(
    screen.getByText('Use 3–30 letters, numbers or underscores, starting with a letter or number.'),
  ).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});

it('pins an onboarding submission to the form session and ignores completion after unmount', async () => {
  let finish: () => void = () => {};
  save.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount } = render(<OnboardingScreen />);
  continueSetup(4);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  expect(save).toHaveBeenCalledWith(expect.any(Object), mockSession.access_token);
  unmount();
  await act(async () => finish());
  expect(mockReload).not.toHaveBeenCalled();
});

it('discards the old account draft and late save when switching accounts without a loading render', async () => {
  let finish: () => void = () => {};
  save.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<OnboardingScreen />);
  continueSetup(3);
  fireEvent.changeText(screen.getByLabelText('Username'), 'first_account_draft');
  continueSetup();
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  mockSession = makeSession('second-user');
  mockAccount = makeAccount('second-user');
  rerender(<OnboardingScreen />);
  expect(screen.getByRole('header', { name: 'Make it yours' })).toBeVisible();
  expect(screen.queryByLabelText('Username')).toBeNull();
  continueSetup(3);
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('learner');
  await act(async () => finish());
  expect(mockReload).not.toHaveBeenCalled();
});

it('retains the draft when the same account receives a refreshed session', () => {
  const { rerender } = render(<OnboardingScreen />);
  continueSetup(3);
  fireEvent.changeText(screen.getByLabelText('Username'), 'unsaved_draft');
  mockSession = { ...mockSession, access_token: 'refreshed-token' };
  rerender(<OnboardingScreen />);
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('unsaved_draft');
});

it('guides one decision at a time, validates levels and preserves choices on back', () => {
  mockAccount = { ...mockAccount, learning: null };
  render(<OnboardingScreen />);
  expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAccessibilityValue({
    min: 1,
    max: 5,
    now: 1,
    text: 'Step 1 of 5',
  });
  expect(screen.queryByRole('button', { name: 'Previous setup step' })).toBeNull();
  expect(screen.getByLabelText('Translation language')).toBeVisible();
  expect(screen.queryByLabelText('Username')).toBeNull();
  continueSetup();
  expect(screen.getByLabelText('Learning language')).toBeVisible();
  fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  continueSetup();
  expect(screen.getByText('Choose two different languages.')).toBeVisible();
  fireEvent.press(screen.getByRole('radio', { name: 'French' }));
  continueSetup(2);
  expect(screen.getByText('Choose your current level.')).toBeVisible();
  fireEvent.press(screen.getByRole('radio', { name: 'A1 — Beginner' }));
  continueSetup();
  fireEvent.changeText(screen.getByLabelText('Username'), 'new_learner');
  fireEvent.press(screen.getByRole('button', { name: 'Previous setup step' }));
  expect(screen.getByRole('radio', { name: 'A1 — Beginner' })).toBeChecked();
  continueSetup();
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('new_learner');
  expect(save).not.toHaveBeenCalled();
});

it('advances from username using keyboard Next and dismisses the keyboard', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  render(<OnboardingScreen />);
  continueSetup(3);
  dismiss.mockClear();
  fireEvent(screen.getByLabelText('Username'), 'submitEditing');
  expect(screen.getByRole('header', { name: 'Your day, your rhythm' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Timezone' })).toHaveAccessibilityValue({
    text: 'America/Toronto',
  });
  expect(dismiss).toHaveBeenCalledTimes(1);
  dismiss.mockRestore();
});

it('uses hardware back for previous steps, and never skips a pending save', async () => {
  let onBack: Parameters<typeof BackHandler.addEventListener>[1] | undefined;
  const backEvent = { type: 'hardwareBackPress', timeStamp: 1 };
  const remove = jest.fn();
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
    onBack = handler;
    return { remove };
  });
  let finish: () => void = () => {};
  save.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const app = render(<OnboardingScreen />);
  expect(onBack?.(backEvent)).toBe(false);
  continueSetup();
  act(() => {
    expect(onBack?.(backEvent)).toBe(true);
  });
  expect(screen.getByRole('header', { name: 'Make it yours' })).toBeVisible();
  continueSetup(4);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  act(() => {
    expect(onBack?.(backEvent)).toBe(true);
  });
  expect(screen.getByRole('button', { name: 'Previous setup step' })).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(mockReload).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  app.unmount();
  expect(remove).toHaveBeenCalled();
  listener.mockRestore();
});

it('revalidates all choices against the current language catalog before the single final save', () => {
  const app = render(<OnboardingScreen />);
  continueSetup(4);
  mockAccount = {
    ...mockAccount,
    languages: mockAccount.languages.map((language) =>
      language.id === 'en' ? { ...language, id: 'de', name: 'German' } : language,
    ),
  };
  app.rerender(<OnboardingScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  expect(screen.getByRole('header', { name: 'Make it yours' })).toBeVisible();
  expect(screen.getByText('Choose your translation language.')).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});

it('keeps the final step and draft after a network failure, allowing an explicit retry', async () => {
  save.mockRejectedValueOnce(new Error('offline'));
  render(<OnboardingScreen />);
  continueSetup(4);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  expect(await screen.findByText(/couldn’t save your setup/)).toBeVisible();
  expect(screen.getByRole('header', { name: 'Your day, your rhythm' })).toBeVisible();
  expect(mockReload).not.toHaveBeenCalled();
  save.mockResolvedValueOnce(undefined);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith(
    {
      username: 'learner',
      referenceLanguageId: 'en',
      targetLanguageId: 'fr',
      cefrLevel: 'B1',
      timezone: 'America/Toronto',
    },
    mockSession.access_token,
  );
});

it('shows language recovery without advancing when the active catalog is unavailable', () => {
  mockAccount = { ...mockAccount, languages: mockAccount.languages.slice(0, 1) };
  render(<OnboardingScreen />);
  expect(screen.getByText('We couldn’t load the languages. Try again.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Reload languages' }));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it('keeps navigation and typing quiet, using selection feedback only when a choice changes', () => {
  render(<OnboardingScreen />);
  fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  continueSetup(3);
  fireEvent.changeText(screen.getByLabelText('Username'), 'draft_name');
  fireEvent.press(screen.getByRole('button', { name: 'Previous setup step' }));
  expect(feedback.selection).not.toHaveBeenCalled();
  expect(feedback.confirm).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  expect(feedback.warning).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('radio', { name: 'A1 — Beginner' }));
  expect(feedback.selection).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('radio', { name: 'A1 — Beginner' }));
  expect(feedback.selection).toHaveBeenCalledTimes(1);
});

it('keeps progress and Continue outside the scrolling choices and inside keyboard avoidance', () => {
  const app = render(<OnboardingScreen />);
  const content = within(app.UNSAFE_getByType(ScrollView));
  expect(content.getByLabelText('Translation language')).toBeVisible();
  expect(content.getByRole('radio', { name: 'English' })).toBeVisible();
  expect(content.queryByRole('progressbar')).toBeNull();
  expect(content.queryByRole('button', { name: 'Continue' })).toBeNull();
  const keyboard = within(app.UNSAFE_getByType(KeyboardAvoidingView));
  expect(keyboard.getByRole('button', { name: 'Continue' })).toBeVisible();
  expect(keyboard.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();
  expect(screen.getByRole('image', { name: 'Langtify' })).toBeVisible();
  continueSetup();
  expect(screen.queryByRole('image', { name: 'Langtify' })).toBeNull();
  expect(screen.getByText('Your setup')).toBeVisible();
});

it('shows native language names and descriptive level choices without auto-advancing', () => {
  render(<OnboardingScreen />);
  const french = screen.getByRole('radio', { name: 'French' });
  expect(within(french).getByText('Français')).toBeVisible();
  fireEvent.press(french);
  expect(french).toBeChecked();
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 1 });
  fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  continueSetup(2);
  const beginner = screen.getByRole('radio', { name: 'A1 — Beginner' });
  expect(beginner.props.accessibilityHint).toBe('Familiar words and simple phrases');
  fireEvent.press(beginner);
  expect(beginner).toBeChecked();
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 3 });
  const detail = within(beginner).getByText('Familiar words and simple phrases');
  expect(detail.props.numberOfLines).toBeUndefined();
  expect(detail.props.allowFontScaling).not.toBe(false);
});

it('keeps Sign out available behind setup options without losing the current draft', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  render(<OnboardingScreen />);
  continueSetup(3);
  fireEvent.changeText(screen.getByLabelText('Username'), 'my_draft');
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  dismiss.mockClear();
  fireEvent.press(screen.getByRole('button', { name: 'Setup options' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Close Setup options' }));
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('my_draft');
  dismiss.mockRestore();
});

it('retains timezone selection on back/forward and reports each of the five steps', () => {
  render(<OnboardingScreen />);
  for (let step = 1; step <= 5; step++) {
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({
      min: 1,
      max: 5,
      now: step,
      text: `Step ${step} of 5`,
    });
    if (step < 5) continueSetup();
  }
  fireEvent.press(screen.getByRole('button', { name: 'Timezone' }));
  fireEvent.changeText(screen.getByLabelText('Search timezones'), 'Paris');
  fireEvent.press(screen.getByRole('radio', { name: 'Europe / Paris' }));
  expect(screen.getByText('Paris')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Previous setup step' }));
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('learner');
  continueSetup();
  expect(screen.getByRole('button', { name: 'Timezone' })).toHaveAccessibilityValue({
    text: 'Europe/Paris',
  });
  expect(save).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)(
  'keeps choices and selected state readable in %s mode',
  (mode) => {
    const appearance = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(mode);
    const app = render(<OnboardingScreen />);
    const english = screen.getByRole('radio', { name: 'English' });
    expect(english).toHaveStyle({
      backgroundColor: palette[mode].surface,
      borderColor: palette[mode].brandPrimary,
    });
    expect(english).toBeChecked();
    expect(within(english).getByText('English')).toHaveStyle({ color: palette[mode].textPrimary });
    expect(screen.getByRole('radio', { name: 'French' })).not.toBeChecked();
    app.unmount();
    appearance.mockRestore();
  },
);
