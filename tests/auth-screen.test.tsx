import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';
import * as runtime from '@/features/auth/oauth/runtime';
import { AuthScreen } from '@/features/auth/auth-screen';

let mockCodeLength: number | null = null;
jest.mock('@/features/auth/email-verification', () => ({
  get emailCodeLength() {
    return mockCodeLength;
  },
}));
const mockVerify = jest.spyOn(runtime, 'verifySignupCode');
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
  jest.useFakeTimers();
  mockCodeLength = null;
  mockVerify.mockResolvedValue(undefined);
  mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
  mockResend.mockResolvedValue({ error: null });
});
afterEach(() => jest.useRealTimers());
function fillCredentials() {
  fireEvent.changeText(screen.getByLabelText('Email'), ' learner@example.test ');
  fireEvent.changeText(screen.getByLabelText('Password'), 'example-password');
}
async function createAccount() {
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByText(mockCodeLength ? 'Verify your email' : 'Check your inbox'),
  ).toBeVisible();
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
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
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
    expect(
      screen.queryByText(/we sent|email is on its way|already registered|private details/i),
    ).toBeNull();
    expect(mockResend).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Change email' }));
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  },
);
it('resends only the submitted signup email without creating another account or claiming delivery', async () => {
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  expect(
    await screen.findByText(/If verification is still needed, look for a new email/),
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
  expect(screen.getByRole('button', { name: /Resend verification available/ })).toBeDisabled();
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
  expect(screen.getByRole('button', { name: 'Change email' })).toBeDisabled();
  await act(async () => finish());
});
it('offers verification recovery after a password sign-in that needs confirmation', async () => {
  mockSignIn.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
  renderRouter(routes, { initialUrl: '/sign-in' });
  fillCredentials();
  expect(screen.queryByRole('button', { name: 'Resend verification' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Check your inbox')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  await waitFor(() =>
    expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'learner@example.test' }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Change email' }));
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

it.each([6, 8, 10])(
  'accepts a pasted %i-digit code with native autofill and one explicit verification',
  async (length) => {
    mockCodeLength = length;
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    expect(screen.queryByText(/we sent/i)).toBeNull();
    const input = screen.getByLabelText('Verification code');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.inputMode).toBe('numeric');
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
    fireEvent.changeText(input, '1'.repeat(length - 1));
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
    fireEvent.changeText(input, ` ${'1'.repeat(length / 2)}-${'2'.repeat(Math.ceil(length / 2))} `);
    const token = '1'.repeat(length / 2) + '2'.repeat(Math.ceil(length / 2));
    fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() =>
      expect(mockVerify).toHaveBeenCalledWith('learner@example.test', token, expect.any(Function)),
    );
  },
);
it.each(['otp_expired', 'access_denied', 'validation_failed', 'user_not_found'])(
  'hides account existence for failed verification: %s',
  async (code) => {
    mockCodeLength = 6;
    mockVerify.mockRejectedValue({ code, message: 'private account details' });
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText(/That code is incorrect or has expired/)).toBeVisible();
    expect(screen.queryByText('private account details')).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
  },
);
it.each([{ code: 'over_request_rate_limit' }, new Error('private network detail')])(
  'allows recovery from verification transport/rate limits without replay',
  async (failure) => {
    mockCodeLength = 6;
    mockVerify.mockRejectedValue(failure);
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/private network/)).toBeNull();
  },
);
it('starts a resend cooldown for new and obscured signup and never auto-sends', async () => {
  mockCodeLength = 6;
  mockSignUp.mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null });
  renderRouter(routes, { initialUrl: '/sign-up' });
  fillCredentials();
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Verify your email')).toBeVisible();
  expect(screen.getByRole('button', { name: /Resend verification available/ })).toBeDisabled();
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByRole('button', { name: 'Resend verification' })).toBeEnabled();
  expect(mockResend).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification' }));
  await waitFor(() => expect(screen.getByLabelText('Verification code')).toHaveDisplayValue(''));
});
it('fences a pending code verification when its screen unmounts', async () => {
  mockCodeLength = 6;
  let resolve: () => void = () => {};
  mockVerify.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const view = renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
  fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Change email' })).toBeDisabled();
  const current = mockVerify.mock.calls[0][2];
  expect(current()).toBe(true);
  view.unmount();
  expect(current()).toBe(false);
  await act(async () => resolve());
});
it('offers an accessible password toggle without altering the value or autofill', () => {
  renderRouter(routes, { initialUrl: '/sign-up' });
  fillCredentials();
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('Password').props.textContentType).toBe('newPassword');
  expect(screen.getByLabelText('Email').props.returnKeyType).toBe('next');
  fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText('Password')).toHaveDisplayValue('example-password');
  fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
});

it('replaces auth modes without growing a back stack and keeps verification out of route parameters', async () => {
  const app = renderRouter(routes, { initialUrl: '/sign-in' });
  fireEvent.press(screen.getByRole('link', { name: /New to Langtify/ }));
  expect(app.getPathname()).toBe('/sign-up');
  await createAccount();
  expect(app.getPathname()).toBe('/sign-up');
  expect(app.getSearchParams()).toEqual({});
  expect(router.canGoBack()).toBe(false);
  fireEvent.press(screen.getByRole('link', { name: 'Back to sign in' }));
  expect(app.getPathname()).toBe('/sign-in');
  expect(screen.getByLabelText('Email')).toHaveDisplayValue('');
});
it('keeps code verification single-flight and accepts only an exact numeric code', async () => {
  mockCodeLength = 6;
  let finish: () => void = () => {};
  mockVerify.mockReturnValue(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  for (const value of ['12345', 'abc123', '<script>', '12-34']) {
    fireEvent.changeText(screen.getByLabelText('Verification code'), value);
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
  }
  fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
  const button = screen.getByRole('button', { name: 'Verify email' });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(mockVerify).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Resend verification' })).toBeDisabled();
  await act(async () => finish());
});

it.each([6, 8, 10])(
  'bounds typing and visual slots to the shared %i-digit setting',
  async (length) => {
    mockCodeLength = length;
    renderRouter(routes, { initialUrl: '/sign-up' });
    await createAccount();
    const input = screen.getByLabelText('Verification code');
    expect(input).toHaveProp('maxLength', length);
    expect(input).toHaveProp(
      'accessibilityHint',
      `Enter the ${length}-digit code from your email.`,
    );
    expect(screen.getAllByTestId('signup-code-slot', { includeHiddenElements: true })).toHaveLength(
      length,
    );
    expect(screen.getAllByLabelText('Verification code')).toHaveLength(1);
    for (let digits = 1; digits < length; digits++) {
      fireEvent.changeText(input, '1'.repeat(digits));
      expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
    }
    fireEvent.changeText(input, '1'.repeat(length));
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    fireEvent.changeText(input, '1'.repeat(length) + '23');
    expect(input).toHaveDisplayValue('1'.repeat(length));
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    expect(mockVerify).not.toHaveBeenCalled();
    fireEvent.changeText(input, '1'.repeat(length - 1));
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
  },
);
it.each([
  ['12345678901234567890', '123456', true],
  ['a1b2 3-4.5\n6789!', '123456', true],
  ['012345678', '012345', true],
  ['ab1!2🙂3', '123', false],
  ['abc- 🙂１２３', '', false],
])('sanitizes pasted %s and updates Verify immediately', async (pasted, expected, ready) => {
  mockCodeLength = 6;
  renderRouter(routes, { initialUrl: '/sign-up' });
  await createAccount();
  const input = screen.getByLabelText('Verification code');
  fireEvent.changeText(input, pasted);
  expect(input).toHaveDisplayValue(expected);
  const verify = screen.getByRole('button', { name: 'Verify email' });
  if (ready) {
    expect(verify).toBeEnabled();
    fireEvent.press(verify);
    await waitFor(() =>
      expect(mockVerify).toHaveBeenCalledWith(
        'learner@example.test',
        expected,
        expect.any(Function),
      ),
    );
  } else {
    expect(verify).toBeDisabled();
    fireEvent.press(verify);
    expect(mockVerify).not.toHaveBeenCalled();
  }
});
