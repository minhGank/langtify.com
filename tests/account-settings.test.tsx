import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountSettingsScreen } from '@/features/profile/account-settings-screen';
import { makeSession } from './fixtures';
const mockDelete = jest.fn();
const mockSession = makeSession();
let mockStatus = 'ready';
jest.mock('@/services/account-deletion', () => ({
  deleteAccount: (...args: unknown[]) => mockDelete(...args),
}));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: mockStatus, session: mockSession }),
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
beforeEach(() => {
  mockStatus = 'ready';
  mockDelete.mockReset().mockResolvedValue(undefined);
});
it('requires explicit typed confirmation and allows cancellation', () => {
  render(<AccountSettingsScreen />);
  fireEvent.press(screen.getByText('Delete Account'));
  expect(screen.getByText(/This cannot be undone/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.getByText('Delete Account')).toBeVisible();
});
it('dispatches once and shows loading until deletion completes', async () => {
  mockDelete.mockReturnValue(new Promise(() => {}));
  render(<AccountSettingsScreen />);
  fireEvent.press(screen.getByText('Delete Account'));
  fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  fireEvent.press(screen.getByText('Permanently delete account'));
  fireEvent.press(screen.getByText('Permanently delete account'));
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
});
it('reports uncertain failure without displaying provider errors and permits retry', async () => {
  mockDelete.mockRejectedValueOnce(new Error('private provider error'));
  render(<AccountSettingsScreen />);
  fireEvent.press(screen.getByText('Delete Account'));
  fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  fireEvent.press(screen.getByText('Permanently delete account'));
  await screen.findByText(/We couldn’t confirm deletion/);
  expect(screen.queryByText('private provider error')).toBeNull();
  fireEvent.press(screen.getByText('Permanently delete account'));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(2));
});

it('also offers deletion before onboarding is complete', () => {
  mockStatus = 'onboarding';
  render(<AccountSettingsScreen />);
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeVisible();
});
