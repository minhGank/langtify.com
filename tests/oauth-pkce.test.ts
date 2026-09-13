import { createHash, webcrypto as mockWebcrypto } from 'node:crypto';
import { TextEncoder as NodeTextEncoder } from 'node:util';
import { createOAuthAttempt } from '@/features/auth/oauth/pkce-attempt';
import { makeSession } from './fixtures';

jest.mock('expo-crypto', () => ({
  getRandomValues: (array: Uint8Array) => mockWebcrypto.getRandomValues(array),
  digest: (_algorithm: string, value: Uint8Array) => mockWebcrypto.subtle.digest('SHA-256', value),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
it('uses the installed Supabase SDK for S256 PKCE, restores its flow verifier, and never stores the staged session', async () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: NodeTextEncoder });
  const saved = new Map<string, string>();
  const store = {
    getItem: async (key: string) => saved.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: async (key: string) => {
      saved.delete(key);
    },
    keys: async () => [...saved.keys()],
  };
  const config = { url: 'https://auth.example.test', key: 'public-test-key' };
  const key = 'sdk-test-oauth';
  const attempt = createOAuthAttempt(config, key, store);
  const { url, flowId } = await attempt.authorize('langtify://auth/callback');
  const params = new URL(url).searchParams;
  expect(params.get('provider')).toBe('google');
  expect(params.get('redirect_to')).toBe('langtify://auth/callback');
  expect(params.get('code_challenge_method')).toBe('s256');
  expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(flowId).toBeTruthy();
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(makeSession()), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  try {
    // A new SDK instance has only durable PKCE storage, as on a cold return.
    const restored = createOAuthAttempt(config, key, store);
    const session = await restored.exchange('single-use-test-code', flowId);
    expect(session.user.id).toBe(makeSession().user.id);
    const [endpoint, options] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe(`${config.url}/auth/v1/token?grant_type=pkce`);
    const body: unknown = JSON.parse(String(options?.body));
    if (
      !body ||
      typeof body !== 'object' ||
      !('code_verifier' in body) ||
      typeof body.code_verifier !== 'string'
    )
      throw new Error('Missing verifier');
    expect(body).toMatchObject({ auth_code: 'single-use-test-code' });
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(
      params.get('code_challenge'),
    );
    expect(saved.has(key)).toBe(false);
    expect([...saved.values()].join('')).not.toContain(session.refresh_token);
    await restored.clear();
    expect(saved.size).toBe(0);
    // An explicit consumed flow cannot fall back to another attempt's verifier.
    await expect(restored.exchange('replayed-test-code', flowId)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    fetchMock.mockRestore();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: mockWebcrypto });
  }
});
