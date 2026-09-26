import { usernameError } from '@/features/profile/profile-errors';

it('explains a known username conflict without exposing arbitrary service errors', () => {
  expect(usernameError(new Error('That username is already taken.'))).toContain(
    'username is taken',
  );
  for (const error of [
    new Error('private Auth token or storage path'),
    { message: 'PostgreSQL details' },
    null,
  ]) {
    expect(usernameError(error)).toBe(
      'We couldn’t confirm your username change. Check your profile before trying again.',
    );
  }
});
