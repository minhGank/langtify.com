import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Keyboard } from 'react-native';

import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { completeOnboarding } from '@/services/account';
import { feedback } from '@/lib/haptics';
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
  fireEvent.press(screen.getByRole('radio', { name: 'English (English)' }));
  continueSetup();
  expect(screen.getByText('Choose two different languages.')).toBeVisible();
  fireEvent.press(screen.getByRole('radio', { name: 'French (Français)' }));
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
  fireEvent.press(screen.getByRole('radio', { name: 'English (English)' }));
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
