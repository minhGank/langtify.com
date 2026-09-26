import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AuthScreen } from '@/features/auth/auth-screen';

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
const mockResend = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      signInWithPassword: mockSignIn,
      signUp: mockSignUp,
      resend: mockResend,
    },
  }),
}));
const routes = {
  'sign-in': () => <AuthScreen mode="sign-in" />,
  'sign-up': () => <AuthScreen mode="sign-up" />,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
  mockResend.mockResolvedValue({ error: null });
});
function fillCredentials() {
  fireEvent.changeText(screen.getByLabelText('Email'), ' learner@example.test ');
  fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');
}
async function createAccount() {
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Check your inbox')).toBeVisible();
}
it('shows safe invalid credentials and sends the exact untrimmed password', async () => {
  mockSignIn.mockResolvedValue({
    error: { code: 'invalid_credentials', message: 'private details' },
  });
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Email or password is incorrect.')).toBeVisible();
  expect(screen.queryByText('private details')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(mockSignIn).toHaveBeenCalledWith({
    email: 'learner@example.test',
    password: 'example-password',
  });
});
it.each([
  { data: { session: null, user: { identities: [{ provider: 'email' }] } }, error: null },
  { data: { session: null, user: { identities: [] } }, error: null },
  { data: { session: null }, error: { code: 'user_already_exists', message: 'private details' } },
  { data: { session: null }, error: { code: 'email_exists', message: 'private details' } },
])(
  'uses identical conditional guidance for new and obscured signup responses %#',
  async (result) => {
    mockSignUp.mockResolvedValue(result);
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    expect(screen.getByText(/If you can create an account with this email/)).toBeVisible();
    expect(screen.getByText(/Check your spam folder/)).toBeVisible();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Resend verification' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect(
      screen.queryByText(/we sent|email is on its way|already registered|private details/i),
    ).toBeNull();
    expect(mockResend).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  },
);
it('resends only the submitted signup email without creating another account or claiming delivery', async () => {
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  expect(
    await screen.findByText(/If verification is still needed, look for a new link/),
  ).toBeVisible();
  expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'learner@example.test' });
  expect(mockSignUp).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/we sent|email sent/i)).toBeNull();
});
it.each(['email_already_confirmed', 'user_not_found', 'email_exists'])(
  'does not disclose resend account status: %s',
  async (code) => {
    mockResend.mockResolvedValue({ error: { code, message: 'private account status' } });
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
    expect(await screen.findByText(/If verification is still needed/)).toBeVisible();
    expect(screen.queryByText('private account status')).toBeNull();
  },
);
it('keeps provider rate limits readable without exposing provider errors', async () => {
  mockResend.mockResolvedValue({
    error: { code: 'over_email_send_rate_limit', message: 'SMTP private details' },
  });
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  expect(await screen.findByText('Too many attempts. Try again later.')).toBeVisible();
  expect(screen.queryByText(/SMTP private details/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Resend verification' })).toBeEnabled();
});
it('prevents overlapping resend requests and disables alternate account actions while pending', async () => {
  let finish: () => void = () => {};
  mockResend.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ error: null });
      }),
  );
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  const resend = screen.getByRole('button', { name: 'Resend verification' });
  fireEvent.press(resend);
  fireEvent.press(resend);
  await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use another email' })).toBeDisabled();
  await act(async () => finish());
});
it('offers verification recovery after a password sign-in that needs confirmation', async () => {
  mockSignIn.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  expect(screen.queryByRole('button', { name: 'Resend verification' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Verify your email before signing in.')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  await waitFor(() =>
    expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'learner@example.test' }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
  fireEvent.changeText(screen.getByLabelText('Email'), 'different@example.test');
  expect(screen.queryByRole('button', { name: 'Resend verification' })).toBeNull();
});
it('maps thrown network failures without leaking their message', async () => {
  mockSignIn.mockRejectedValue(new Error('private network details'));
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/Check your connection and try again/)).toBeVisible();
  expect(screen.queryByText('private network details')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
it('places required errors beside inputs and clears them as the user edits', async () => {
  renderRouter(routes, { initialUrl: '/sign-in' });
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByText('Enter a valid email address.')).toBeVisible();
  expect(screen.getByText('Enter your password.')).toBeVisible();
  expect(mockSignIn).not.toHaveBeenCalled();
  fillCredentials();
  expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  expect(screen.queryByText('Enter your password.')).toBeNull();
});
it('shows human-readable guidance and live exact length validation before submission', async () => {
  renderRouter(routes, { initialUrl: '/sign-up' });
  expect(screen.getByText(/Use 6–72 characters/)).toBeVisible();
  expect(screen.queryByText(/bytes/)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Email'), 'learner@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'abcde');
  expect(screen.getByText('Use a longer password.')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  expect(mockSignUp).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Password'), '語語');
  expect(screen.getByText('Length requirement met')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() =>
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'learner@example.test', password: '語語' }),
  );
  expect(await screen.findByText('Check your inbox')).toBeVisible();
});
it('does not apply signup password rules to existing password sign-in', async () => {
  mockSignIn.mockResolvedValue({ error: null });
  renderRouter(routes, { initialUrl: '/sign-in' });
  expect(screen.queryByText(/Use 6–72 characters/)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Email'), 'learner@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'old');
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'learner@example.test', password: 'old' }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
});
it('puts a known breach rejection beside the password without displaying raw backend text', async () => {
  mockSignUp.mockResolvedValue({
    data: { session: null },
    error: { code: 'weak_password', reasons: ['pwned'], message: 'private backend details' },
  });
  renderRouter(routes, { initialUrl: '/sign-up' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByText(
      'This password has appeared in a data breach. Choose a different password.',
    ),
  ).toBeVisible();
  expect(screen.getByLabelText('Password').props.accessibilityHint).toContain('data breach');
  expect(screen.queryByText('private backend details')).toBeNull();
});
