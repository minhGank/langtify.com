import { exchangeSignupCode, signupCodeLength } from '@/features/auth/email-verification';
import { createClient } from '@supabase/supabase-js';
import { makeOAuthSession } from './fixtures';
const mockVerify = jest.fn();
const mockDispose = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { verifyOtp: mockVerify, dispose: mockDispose } })),
}));
beforeEach(() => {
  jest.clearAllMocks();
});
it.each([undefined, '', '0', '5', '11', '6.0', 'true', '6junk'])(
  'keeps link mode for an absent/invalid rollout contract: %s',
  (value) => {
    expect(signupCodeLength(value)).toBeNull();
  },
);
it.each([6, 7, 8, 9, 10])('accepts an explicitly configured %i-digit contract', (value) =>
  expect(signupCodeLength(String(value))).toBe(value),
);
it('stages only a signup confirmation session without persistence, refresh or redirects', async () => {
  const candidate = {
    ...makeOAuthSession(),
    user: { ...makeOAuthSession().user, email_confirmed_at: '2026-09-26' },
  };
  mockVerify.mockResolvedValue({ data: { session: candidate, user: candidate.user }, error: null });
  expect(
    await exchangeSignupCode(
      { url: 'https://example.test', key: 'sb_publishable_test' },
      'learner@example.test',
      '123456',
    ),
  ).toBe(candidate);
  expect(mockVerify).toHaveBeenCalledWith({
    email: 'learner@example.test',
    token: '123456',
    type: 'signup',
  });
  expect(createClient).toHaveBeenCalledWith(
    'https://example.test',
    'sb_publishable_test',
    expect.objectContaining({
      auth: expect.objectContaining({
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      }),
    }),
  );
  expect(mockDispose).toHaveBeenCalled();
});
it('disposes the candidate client on provider rejection and never fabricates a session', async () => {
  const failure = { code: 'otp_expired' };
  mockVerify.mockResolvedValue({ data: { session: null, user: null }, error: failure });
  await expect(
    exchangeSignupCode(
      { url: 'https://example.test', key: 'sb_publishable_test' },
      'learner@example.test',
      '123456',
    ),
  ).rejects.toBe(failure);
  expect(mockDispose).toHaveBeenCalled();
});
