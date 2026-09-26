export function usernameError(error: unknown): string {
  // The service maps this known conflict. Never render an arbitrary Error.message
  // from Auth refresh, transport, RLS, or a database response.
  if (error instanceof Error && error.message === 'That username is already taken.')
    return 'That username is taken. Try another.';
  return 'We couldn’t confirm your username change. Check your profile before trying again.';
}
