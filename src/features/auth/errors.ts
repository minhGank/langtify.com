export function friendlyError(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  switch (code) {
    case 'invalid_credentials':
      return 'The email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Please confirm your email, then sign in.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Unable to create this account. Try signing in or use another email.';
    case 'weak_password':
      return 'This password does not meet the account security requirements. Try a longer, stronger password.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a little and try again.';
    case '23505':
      return 'That username is already taken. Please choose another.';
    case '23514':
      return 'Please review your choices and timezone, then try again.';
    default:
      return fallback;
  }
}
