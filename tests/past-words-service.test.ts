import { parsePastWordsPage, pastWordsGateway, PastWordsUnavailable } from '@/services/past-words';

const mockRpc = jest.fn(),
  mockAbort = jest.fn(),
  mockCreate = jest.fn();
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://api.example.test', key: 'test-public-key' } },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mockCreate(...args);
    return { rpc: mockRpc };
  },
}));
const id = (n: number) => `93000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { userId: id(1), token: 'pinned-token', timezone: 'America/Toronto' };
const item = {
  assignment_id: id(2),
  concept_id: id(3),
  challenge_date: '2026-09-21',
  target_term: 'le chien',
  reference_term: 'dog',
  cefr_level: 'A1',
  has_capture: false,
  submission_id: null,
  submission_status: null,
  capture_kind: null,
};
const payload = {
  user_id: identity.userId,
  current_local_date: '2026-09-22',
  items: [item],
  has_more: false,
};
function response(data: unknown, error: unknown = null) {
  const request = Object.assign(Promise.resolve({ data, error }), { abortSignal: mockAbort });
  mockAbort.mockReturnValue(request);
  mockRpc.mockReturnValue(request);
}
beforeEach(() => jest.clearAllMocks());

it('parses owned final assignments without rewriting historical text or dates', () => {
  expect(parsePastWordsPage(payload, identity.userId)).toEqual({
    currentLocalDate: '2026-09-22',
    items: [
      {
        assignmentId: id(2),
        conceptId: id(3),
        challengeDate: '2026-09-21',
        targetTerm: 'le chien',
        referenceTerm: 'dog',
        cefrLevel: 'A1',
        hasCapture: false,
        submissionId: null,
        submissionStatus: null,
        captureKind: null,
      },
    ],
    hasMore: false,
  });
  // The date is server-provided: device clock changes do not change membership.
  jest.useFakeTimers().setSystemTime(new Date('2000-01-01T00:00:00Z'));
  expect(parsePastWordsPage(payload, identity.userId).items).toHaveLength(1);
  jest.useRealTimers();
});

it.each([
  { user_id: id(99) },
  { current_local_date: 'invalid' },
  { current_local_date: '2026-02-30' },
  { items: [item, item] },
  { items: Array(21).fill(item) },
  { items: [], has_more: true },
  { items: [{ ...item, challenge_date: '2026-09-22' }] },
  { items: [{ ...item, challenge_date: '2026-09-23' }] },
  { items: [{ ...item, challenge_date: '2026-02-30' }] },
  { items: [{ ...item, assignment_id: 'spoofed' }] },
  { items: [{ ...item, cefr_level: 'A0' }] },
  { items: [{ ...item, target_term: ' ' }] },
  { items: [{ ...item, reference_term: '' }] },
  { items: [{ ...item, has_capture: true }] },
  { items: [{ ...item, submission_status: 'pending' }] },
  { items: [{ ...item, capture_kind: 'historical' }] },
  { items: [{ ...item, submission_id: id(4) }] },
])('rejects a foreign, unbounded or inconsistent history response %#', (changes) => {
  expect(() => parsePastWordsPage({ ...payload, ...changes }, identity.userId)).toThrow();
});

it.each(['daily', 'historical'] as const)(
  'accepts captured and unfinished %s lifecycle states',
  (kind) => {
    for (const status of ['pending', 'completed', 'deleting'] as const) {
      const entry = {
        ...item,
        submission_id: id(4),
        submission_status: status,
        capture_kind: kind,
        has_capture: status !== 'pending',
      };
      expect(
        parsePastWordsPage({ ...payload, items: [entry] }, identity.userId).items[0],
      ).toMatchObject({
        submissionStatus: status,
        captureKind: kind,
        hasCapture: status !== 'pending',
      });
    }
  },
);

it('keeps repeated concepts as separate actual assignments instead of inventing concept-level XP eligibility', () => {
  const repeated = { ...item, assignment_id: id(5), challenge_date: '2026-09-20' };
  const page = parsePastWordsPage({ ...payload, items: [item, repeated] }, identity.userId);
  expect(page.items.map((entry) => entry.assignmentId)).toEqual([id(2), id(5)]);
  expect(new Set(page.items.map((entry) => entry.conceptId)).size).toBe(1);
});

it('accepts deletion cleanup of a never-finalized reservation without treating it as credited', () => {
  const row = {
    ...item,
    submission_id: id(4),
    submission_status: 'deleting',
    capture_kind: 'historical',
  };
  expect(parsePastWordsPage({ ...payload, items: [row] }, identity.userId).items[0]).toMatchObject({
    hasCapture: false,
    submissionStatus: 'deleting',
  });
});

it('pins the session and requests bounded owner history with exact keysets, no client dates or identity', async () => {
  response(payload);
  const signal = new AbortController().signal;
  await pastWordsGateway(identity).load(
    { search: 'dog', level: 'A1' },
    { captured: false, date: '2026-09-21', id: id(2) },
    signal,
  );
  expect(mockRpc).toHaveBeenCalledWith('get_my_past_words', {
    search_text: 'dog',
    requested_level: 'A1',
    before_captured: false,
    before_date: '2026-09-21',
    before_id: id(2),
    page_size: 20,
  });
  expect(mockAbort).toHaveBeenCalledWith(signal);
  expect(await mockCreate.mock.calls[0][2].accessToken()).toBe(identity.token);
  expect(mockCreate.mock.calls[0][2].auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('handles empty history and fails closed on denied/foreign-account reads', async () => {
  response({ ...payload, items: [] });
  expect(
    await pastWordsGateway(identity).load(
      { search: '', level: '' },
      null,
      new AbortController().signal,
    ),
  ).toMatchObject({ items: [], hasMore: false });
  response(null, { code: '42501', message: 'sensitive diagnostic' });
  await expect(
    pastWordsGateway(identity).load({ search: '', level: '' }, null, new AbortController().signal),
  ).rejects.toBeInstanceOf(PastWordsUnavailable);
  response({ ...payload, user_id: id(99) });
  await expect(
    pastWordsGateway(identity).load({ search: '', level: '' }, null, new AbortController().signal),
  ).rejects.toBeInstanceOf(PastWordsUnavailable);
});
