import { createRecoveryClient, recoveryRedirect } from '@/features/auth/recovery/client';
type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
let mockStorage: Storage;
const mockRequest = jest.fn();
const mockExchange = jest.fn();
const mockUpdate = jest.fn();
const mockDispose = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (
    _url: string,
    _key: string,
    options: { auth: { storage: Storage; flowType: string; detectSessionInUrl: boolean } },
  ) => {
    mockStorage = options.auth.storage;
    expect(options.auth.flowType).toBe('pkce');
    expect(options.auth.detectSessionInUrl).toBe(false);
    return {
      auth: {
        resetPasswordForEmail: mockRequest,
        exchangeCodeForSession: mockExchange,
        updateUser: mockUpdate,
        dispose: mockDispose,
      },
    };
  },
}));
jest.mock('@/lib/oauth-crypto', () => ({ ensureOAuthCrypto: jest.fn() }));
function client() {
  const persisted = new Map<string, string>();
  const store = {
    getItem: async (key: string) => persisted.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      persisted.set(key, value);
    },
    removeItem: async (key: string) => {
      persisted.delete(key);
    },
    keys: async () => [...persisted.keys()],
  };
  return {
    value: createRecoveryClient(
      { url: 'http://localhost:54321', key: 'public-test-key' },
      'recovery-test',
      store,
    ),
    persisted,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null });
});
it('uses the approved redirect and keeps recovery session tokens in memory, with PKCE durable only', async () => {
  const { value, persisted } = client();
  await value.request('person@example.test');
  expect(mockRequest).toHaveBeenCalledWith('person@example.test', { redirectTo: recoveryRedirect });
  await mockStorage.setItem('recovery-test-code-verifier', 'fixture-pkce');
  await mockStorage.setItem('recovery-test', 'fixture-session');
  expect(persisted.has('recovery-test')).toBe(false);
  expect(await mockStorage.getItem('recovery-test')).toBe('fixture-session');
  expect(persisted.get('recovery-test-code-verifier')).toBe('fixture-pkce');
  await value.update(' exact password ');
  expect(mockUpdate).toHaveBeenCalledWith({ password: ' exact password ' });
  await value.clear();
  expect(await mockStorage.getItem('recovery-test')).toBeNull();
  expect(persisted.size).toBe(0);
});
it.each([null, 'signup', 'recovery'])(
  'requires a recovery exchange, not URL type or a generic sign-in: %s',
  async (redirectType) => {
    const { value } = client();
    mockExchange.mockResolvedValue({
      data: { session: { user: { id: 'fixture' } }, redirectType },
      error: null,
    });
    if (redirectType === 'recovery')
      await expect(value.exchange('fixture-code')).resolves.toBeUndefined();
    else await expect(value.exchange('fixture-code')).rejects.toThrow('Invalid recovery');
  },
);
