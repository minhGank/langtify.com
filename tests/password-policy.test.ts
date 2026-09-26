import { readFileSync } from 'node:fs';

import {
  passwordBytes,
  passwordRejection,
  signupPasswordPolicy,
  validateSignupPassword,
} from '@/features/auth/password-policy';

it('matches the explicit local Auth minimum and does not invent character requirements', () => {
  const config = readFileSync('supabase/config.toml', 'utf8');
  expect(config).toMatch(
    new RegExp(`minimum_password_length = ${signupPasswordPolicy.minimumBytes}`),
  );
  expect(config).toContain('password_requirements = ""');
  expect(validateSignupPassword('abcdef')).toBeUndefined();
  expect(validateSignupPassword('123456')).toBeUndefined();
  expect(validateSignupPassword('      ')).toBeUndefined();
});

it('matches GoTrue UTF-8 length boundaries without trimming or counting UTF-16 units', () => {
  expect(validateSignupPassword('')).toBe('Enter your password.');
  expect(validateSignupPassword('abcde')).toContain('longer password');
  expect(validateSignupPassword('a'.repeat(72))).toBeUndefined();
  expect(validateSignupPassword('a'.repeat(73))).toContain('too long');
  expect(passwordBytes('é')).toBe(2);
  expect(passwordBytes('語')).toBe(3);
  expect(passwordBytes('📷')).toBe(4);
  expect(validateSignupPassword('ééé')).toBeUndefined();
  expect(validateSignupPassword('語語')).toBeUndefined();
  expect(validateSignupPassword('📷📷')).toBeUndefined();
  expect(validateSignupPassword('📷'.repeat(18))).toBeUndefined();
  expect(validateSignupPassword('📷'.repeat(19))).toContain('too long');
});

it('maps known backend reasons without displaying arbitrary server content', () => {
  expect(passwordRejection({ code: 'weak_password', reasons: ['pwned'] })).toContain('data breach');
  expect(
    passwordRejection({
      code: 'weak_password',
      message: 'Password should be at least 10 characters.',
    }),
  ).toContain('at least 10 standard letters');
  expect(
    passwordRejection({ code: 'weak_password', message: 'secret backend details' }),
  ).not.toContain('secret backend details');
  expect(passwordRejection({ code: 'invalid_credentials', reasons: ['pwned'] })).toBeUndefined();
  expect(passwordRejection(null)).toBeUndefined();
});
