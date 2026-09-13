import { feedGateway } from '@/services/discover';
const mockRpc = jest.fn(),
  mockInvoke = jest.fn(),
  mockAbort = jest.fn(),
  mockCreate = jest.fn();
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://api.example.test', key: 'test-public-key' } },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mockCreate(...args);
    return { rpc: mockRpc, functions: { invoke: mockInvoke } };
  },
}));
it('pins the viewer JWT, uses bounded cursor RPC and one batch invocation, and preserves cancellation', async () => {
  const identity = { userId: 'viewer', targetLanguageId: 'target', token: 'old-token' };
  const payload = { viewer_id: 'viewer', target_language_id: 'target', items: [], has_more: false };
  mockRpc.mockReturnValue(
    Object.assign(Promise.resolve({ data: payload, error: null }), { abortSignal: mockAbort }),
  );
  mockInvoke.mockResolvedValue({ data: payload, error: null });
  const gateway = feedGateway(identity),
    signal = new AbortController().signal;
  const cursor = { time: '2026-09-13T12:00:00.123456Z', id: 'previous' };
  await gateway.load(cursor, signal);
  expect(await mockCreate.mock.calls[0][2].accessToken()).toBe('old-token');
  expect(mockCreate.mock.calls[0][2].auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_discover_feed', {
    before_time: cursor.time,
    before_id: 'previous',
    page_size: 12,
  });
  expect(mockAbort).toHaveBeenCalledWith(signal);
  await gateway.previews(['a', 'b'], signal);
  expect(mockInvoke).toHaveBeenCalledWith('photo-authority', {
    body: { action: 'feed-previews', submissionIds: ['a', 'b'], targetLanguageId: 'target' },
    signal,
  });
  await gateway.previews([], signal);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
});
