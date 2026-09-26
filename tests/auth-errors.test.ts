import { friendlyError } from '@/features/auth/errors';
it('maps auth, duplicate account and username errors without leaking server details', () => {
  expect(friendlyError({ code: 'invalid_credentials', message: 'internal' }, 'fallback')).toContain(
    'Email or password',
  );
  expect(friendlyError({ code: 'email_exists' }, 'fallback')).toContain('Try signing in');
  expect(friendlyError({ code: '23505' }, 'fallback')).toContain('username');
  expect(friendlyError(new Error('private backend details'), 'Please try again.')).toBe(
    'Please try again.',
  );
});
