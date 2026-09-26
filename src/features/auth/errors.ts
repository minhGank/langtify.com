import { passwordRejection } from '@/features/auth/password-policy';

export function friendlyError(error: unknown, fallback: string) {
  const passwordError = passwordRejection(error);
  if (passwordError) return passwordError;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  switch (code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Verify your email before signing in.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Try signing in or continue with Google.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Try again later.';
    case 'email_address_not_authorized':
    case 'email_provider_disabled':
    case 'signup_disabled':
      return 'Email signup isn’t available right now. Try Google or try again later.';
    case '23505':
      return 'That username is taken. Try another.';
    case '23514':
      return 'Check your choices and timezone, then try again.';
    default:
      return fallback;
  }
}

export function authErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
}

// Do not turn provider-specific account-existence responses into a lookup UI.
export function isObscuredSignup(error: unknown): boolean {
  return ['user_already_exists', 'email_exists'].includes(String(authErrorCode(error)));
}
