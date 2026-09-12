import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { completeOnboarding } from '@/services/account';
import { makeAccount, makeSession } from './fixtures';

const mockReload = jest.fn();
let mockAccount = makeAccount();
let mockSession = makeSession();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ account: mockAccount, session: mockSession, reload: mockReload }),
}));
jest.mock('@/services/account', () => ({ completeOnboarding: jest.fn() }));
const save = jest.mocked(completeOnboarding);
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = makeAccount();
  mockSession = makeSession();
});
it('preserves the setup form and keeps routes locked after a failed transaction', async () => {
  save.mockRejectedValueOnce({ code: '23505' });
  render(<OnboardingScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  expect(
    await screen.findByText('That username is already taken. Please choose another.'),
  ).toBeVisible();
  expect(mockReload).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('learner');
  save.mockResolvedValueOnce(undefined);
  fireEvent.changeText(screen.getByLabelText('Username'), 'another_learner');
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
});
it('rejects invalid fields before attempting to save', () => {
  render(<OnboardingScreen />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'bad name');
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
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
  fireEvent.changeText(screen.getByLabelText('Username'), 'first_account_draft');
  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }));
  mockSession = makeSession('second-user');
  mockAccount = makeAccount('second-user');
  rerender(<OnboardingScreen />);
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('learner');
  await act(async () => finish());
  expect(mockReload).not.toHaveBeenCalled();
});

it('retains the draft when the same account receives a refreshed session', () => {
  const { rerender } = render(<OnboardingScreen />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'unsaved_draft');
  mockSession = { ...mockSession, access_token: 'refreshed-token' };
  rerender(<OnboardingScreen />);
  expect(screen.getByLabelText('Username')).toHaveDisplayValue('unsaved_draft');
});
