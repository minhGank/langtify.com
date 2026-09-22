import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

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

it('places required-field errors beside inputs and clears them as the user edits', async () => {
  renderRouter(routes, { initialUrl: '/sign-in' });
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByText('Enter a valid email address.')).toBeVisible();
  expect(screen.getByText('Enter your password.')).toBeVisible();
  expect(mockSignIn).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Email'), 'learner@example.test');
  expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  expect(screen.getByText('Enter your password.')).toBeVisible();
  fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');
  expect(screen.queryByText('Enter your password.')).toBeNull();
  mockSignIn.mockResolvedValueOnce({ error: null });
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
});

it('shows the verified password policy before signup and validates the actual minimum', async () => {
  mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
  renderRouter(routes, { initialUrl: '/sign-up' });
  expect(screen.getByText(/6–72 bytes.*No required character mix/)).toBeVisible();
  fireEvent.changeText(screen.getByLabelText('Email'), 'learner@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'abcde');
  fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(
    screen.getByText('Use at least 6 bytes (6 standard letters, numbers or symbols).'),
  ).toBeVisible();
  expect(mockSignUp).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Password'), 'abcdef');
  fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  await waitFor(() =>
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'learner@example.test', password: 'abcdef' }),
  );
  expect(await screen.findByText(/If this address can be registered/)).toBeVisible();
});

it('does not apply current signup rules to existing password sign-in', async () => {
  mockSignIn.mockResolvedValue({ error: null });
  renderRouter(routes, { initialUrl: '/sign-in' });
  expect(screen.queryByText(/No required character mix/)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Email'), 'learner@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'old');
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'learner@example.test', password: 'old' }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
});

it('places a backend breach rejection beside the password field without exposing its message', async () => {
  mockSignUp.mockResolvedValue({
    data: { session: null },
    error: { code: 'weak_password', reasons: ['pwned'], message: 'private backend details' },
  });
  renderRouter(routes, { initialUrl: '/sign-up' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(
    await screen.findByText(
      'This password appears in a known data breach. Choose a different password.',
    ),
  ).toBeVisible();
  expect(screen.getByLabelText('Password').props.accessibilityHint).toContain('known data breach');
  expect(screen.queryByText('private backend details')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Password'), 'another password');
  expect(screen.queryByText(/This password appears in a known data breach/)).toBeNull();
});
