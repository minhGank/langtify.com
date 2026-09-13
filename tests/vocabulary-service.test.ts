import { vocabularyGateway } from '@/services/vocabulary';

jest.mock('@/lib/supabase', () => ({ requireSupabase: jest.fn() }));

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
const item = {
  id: 'capture',
  concept_id: 'concept',
  assignment_id: 'assignment',
  target_term: 'chien',
  reference_term: 'dog',
  cefr_level: 'A1',
  submitted_at: '2026-07-06T12:00:00.123456+00:00',
  visibility: 'private',
  capture_count: 2,
};
beforeEach(() => {
  jest.clearAllMocks();
  const request = Promise.resolve({
    data: { user_id: 'owner', items: [item], concept: item, has_more: false, total_concepts: 1 },
    error: null,
  });
  mockRpc.mockReturnValue(Object.assign(request, { abortSignal: mockAbort }));
  mockInvoke.mockResolvedValue({
    data: {
      previews: [
        {
          id: 'capture',
          signedPath: '/storage/v1/object/sign/challenge-submissions/owner/capture.jpg?token=a.b.c',
        },
      ],
    },
    error: null,
  });
});
it('pins the JWT for one RPC and one batch invocation, preserving microsecond cursors and cancellation', async () => {
  const gateway = vocabularyGateway('owner', 'old-token', { search: 'dog', level: 'A1' });
  const signal = new AbortController().signal;
  await gateway.load({ time: item.submitted_at, id: 'previous' }, signal);
  const clientOptions = mockCreate.mock.calls[0][2];
  expect(await clientOptions.accessToken()).toBe('old-token');
  expect(clientOptions.auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_my_vocabulary', {
    requested_concept: undefined,
    search_text: 'dog',
    requested_level: 'A1',
    before_time: item.submitted_at,
    before_id: 'previous',
    page_size: 12,
  });
  expect(mockAbort).toHaveBeenCalledWith(signal);
  await gateway.previews(['capture'], signal);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('photo-authority', {
    body: { action: 'previews', submissionIds: ['capture'] },
    signal,
  });
  await gateway.previews([], signal);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
});
