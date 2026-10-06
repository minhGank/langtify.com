import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { RecoveryController } from '@/features/auth/recovery/controller';
import { RecoveryScreen } from '@/features/auth/recovery/screens';
const id = '00000000-0000-4000-8000-000000000001';
const mockClient = { request: jest.fn(), exchange: jest.fn(), update: jest.fn(), clear: jest.fn() };
let mockController: RecoveryController;
jest.mock('@/features/auth/oauth/runtime', () => ({
  get recovery() {
    return mockController;
  },
  requestPasswordReset: (email: string) =>
    mockController.request(email, '00000000-0000-4000-8000-000000000001'),
  updateRecoveryPassword: (password: string) => mockController.update(password),
}));
beforeEach(() => {
  jest.clearAllMocks();
  let saved: string | null = null;
  mockController = new RecoveryController({
    read: async () => saved,
    write: async (v) => {
      saved = v;
    },
    remove: async () => {
      saved = null;
    },
    client: () => mockClient,
    current: () => true,
    signedIn: async () => false,
    now: Date.now,
  });
});
const routes = {
  'forgot-password': () => <RecoveryScreen mode="request" />,
  'set-new-password': () => <RecoveryScreen mode="password" />,
  'sign-in': () => null,
};
it('validates email and shows neutral confirmation without account disclosure', async () => {
  renderRouter(routes, { initialUrl: '/forgot-password' });
  fireEvent.changeText(screen.getByLabelText('Email'), 'invalid');
  fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
  expect(screen.getByText('Enter a valid email address.')).toBeVisible();
  expect(mockClient.request).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Email'), 'person@example.test');
  fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByText(/If an account can use this email/)).toBeVisible();
});
it('enforces the existing password policy and confirmation before updating; shows success', async () => {
  await mockController.request('person@example.test', id);
  await mockController.receive('langtify://auth/callback?code=valid-code-123');
  renderRouter(routes, { initialUrl: '/set-new-password' });
  fireEvent.changeText(screen.getByLabelText('New password'), 'short');
  fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'short');
  fireEvent.press(screen.getByRole('button', { name: 'Update password' }));
  expect(mockClient.update).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('New password'), 'new-password');
  fireEvent.press(screen.getByRole('button', { name: 'Update password' }));
  expect(screen.getByText('Passwords don’t match.')).toBeVisible();
  fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'new-password');
  fireEvent.press(screen.getByRole('button', { name: 'Update password' }));
  await waitFor(() => expect(mockClient.update).toHaveBeenCalledWith('new-password'));
  expect(await screen.findByText('Password updated')).toBeVisible();
  expect(screen.queryByLabelText('New password')).toBeNull();
});
