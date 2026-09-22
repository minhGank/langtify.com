import { feedGateway, parseRatingReceipt } from '@/services/discover';
import { RatingUnavailable } from '@/features/ratings/rating';
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

it.each([401, 403])(
  'treats signing HTTP %s as an eligibility denial for cache retirement',
  async (status) => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error('Function denied access.'),
      response: { status },
    });
    const gateway = feedGateway({ userId: 'viewer', targetLanguageId: 'target', token: 'token' });
    await expect(gateway.previews(['photo'])).rejects.toBeInstanceOf(RatingUnavailable);
  },
);

it('keeps a signing service outage retryable rather than treating it as an eligibility denial', async () => {
  const failure = new Error('Temporary service failure.');
  mockInvoke.mockResolvedValueOnce({ data: null, error: failure, response: { status: 503 } });
  const gateway = feedGateway({ userId: 'viewer', targetLanguageId: 'target', token: 'token' });
  await expect(gateway.previews(['photo'])).rejects.toBe(failure);
});

it('sends only the submission and semantic score; validates receipt identity and summary', async () => {
  const identity = { userId: 'viewer', targetLanguageId: 'target', token: 'fixed-token' };
  const item = {
    id: 'photo',
    average_rating: 4,
    rating_count: 2,
    viewer_rating: 5,
    can_rate: true,
  };
  const payload = { viewer_id: 'viewer', target_language_id: 'target', item };
  mockRpc.mockReturnValue(
    Object.assign(Promise.resolve({ data: payload, error: null }), { abortSignal: mockAbort }),
  );
  const signal = new AbortController().signal;
  expect((await feedGateway(identity).rate('photo', 5, signal)).viewerRating).toBe(5);
  expect(mockRpc).toHaveBeenLastCalledWith('rate_submission', { submission_id: 'photo', score: 5 });
  expect(mockAbort).toHaveBeenLastCalledWith(signal);
  for (const changed of [
    { viewer_id: 'other' },
    { target_language_id: 'other' },
    { item: { ...item, id: 'other' } },
    { item: { ...item, rating_count: -1 } },
    { item: { ...item, average_rating: 6 } },
    { item: { ...item, viewer_rating: 2.5 } },
    { item: { ...item, can_rate: false } },
  ]) {
    expect(() => parseRatingReceipt({ ...payload, ...changed }, identity, 'photo')).toThrow();
  }
});
