import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { AuthScreen } from '@/features/auth/auth-screen';

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ auth: { signInWithPassword: mockSignIn, signUp: mockSignUp } }),
}));
const routes = {
  'sign-in': () => <AuthScreen mode="sign-in" />,
  'sign-up': () => <AuthScreen mode="sign-up" />,
};
beforeEach(() => {
  jest.clearAllMocks();
});
function fillCredentials() {
  fireEvent.changeText(screen.getByLabelText('Email'), ' learner@example.test ');
  fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');
}
it('shows a safe invalid-credentials message and allows retry', async () => {
  mockSignIn.mockResolvedValue({
    error: { code: 'invalid_credentials', message: 'private details' },
  });
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('The email or password is incorrect.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(mockSignIn).toHaveBeenCalledWith({
    email: 'learner@example.test',
    password: 'example-password',
  });
});
it('handles confirmation and obfuscated duplicate signups without claiming success', async () => {
  mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
  renderRouter(routes, { initialUrl: '/sign-up' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(await screen.findByText(/If this address can be registered/)).toBeVisible();
  expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
});
it('recovers from thrown network failures without exposing the backend error', async () => {
  mockSignIn.mockRejectedValue(new Error('private network details'));
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(
    await screen.findByText('Unable to connect right now. Check your connection and try again.'),
  ).toBeVisible();
  expect(screen.queryByText('private network details')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
