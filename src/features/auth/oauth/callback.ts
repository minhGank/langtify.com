export const callbackPath = 'auth/callback';
export const appScheme = 'langtify';

export function isCallbackUrl(raw: string, redirect: string): boolean {
  try {
    const url = new URL(raw),
      expected = new URL(redirect);
    return (
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function callbackCode(raw: string, redirect: string): string {
  if (!isCallbackUrl(raw, redirect)) throw new Error('invalid_callback');
  const url = new URL(raw);
  if (
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !['code', 'error', 'error_code', 'error_description'].includes(key),
    )
  )
    throw new Error('invalid_callback');
  if (url.searchParams.has('error') || url.searchParams.has('error_code'))
    throw new Error('provider_error');
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !/^[A-Za-z0-9_-]{8,2048}$/.test(codes[0]))
    throw new Error('invalid_callback');
  return codes[0];
}
export function validateAuthorizeUrl(raw: string, apiUrl: string, redirect: string) {
  const url = new URL(raw),
    api = new URL(apiUrl);
  if (
    url.origin !== api.origin ||
    url.pathname !== `${api.pathname.replace(/\/$/, '')}/auth/v1/authorize` ||
    url.username ||
    url.password ||
    url.hash ||
    ['provider', 'redirect_to', 'code_challenge_method', 'code_challenge'].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    ) ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') ?? '') ||
    url.searchParams.get('provider') !== 'google' ||
    url.searchParams.get('redirect_to') !== redirect ||
    url.searchParams.get('code_challenge_method') !== 's256'
  )
    throw new Error('invalid_authorization');
  return raw;
}

export function hasOAuthParameters(raw: string): boolean {
  // Also catch malformed/encoded links; rejection must not echo credentials into
  // Router's not-found route, search parameters, or diagnostics.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* retain raw malformed URL */
  }
  return /[?#&](?:code|access_token|refresh_token|provider_token|provider_refresh_token|error|error_code|error_description)=/i.test(
    decoded,
  );
}
