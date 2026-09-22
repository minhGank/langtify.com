import { exploreGateway, parseExploreConcept, parseWordPage } from '@/services/explore';
import { FeedSettingsChanged } from '@/services/discover';
import { SafetyUnavailable } from '@/features/safety/model';
import { RatingUnavailable } from '@/features/ratings/rating';
import { socialGateway } from '@/services/social';

const mockRpc = jest.fn(),
  mockAbort = jest.fn(),
  mockCreate = jest.fn();
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://api.example.test', key: 'test-public-key' } },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mockCreate(...args);
    return { rpc: mockRpc, functions: { invoke: jest.fn() } };
  },
}));
const id = '83000000-0000-4000-8000-000000000001';
const identity = {
  userId: 'viewer',
  token: 'pinned-token',
  targetLanguageId: 'fr',
  referenceLanguageId: 'en',
};
const item = { concept_id: id, target_term: 'le chien', reference_term: 'dog', cefr_level: 'A1' };
const envelope = { viewer_id: 'viewer', target_language_id: 'fr', reference_language_id: 'en' };
function response(data: unknown, error: unknown = null) {
  const request = Object.assign(Promise.resolve({ data, error }), { abortSignal: mockAbort });
  mockAbort.mockReturnValue(request);
  mockRpc.mockReturnValue(request);
}
beforeEach(() => jest.clearAllMocks());
it('validates the account, both saved languages, bounded unique concepts, terms and CEFR', () => {
  const page = { ...envelope, items: [item], has_more: false };
  expect(parseWordPage(page, identity).items[0].targetTerm).toBe('le chien');
  for (const changed of [
    { viewer_id: 'someone' },
    { target_language_id: 'de' },
    { reference_language_id: 'de' },
    { items: [item, item] },
    { items: Array(21).fill(item) },
    { items: [{ ...item, cefr_level: 'A0' }] },
    { items: [{ ...item, target_term: ' ' }] },
  ]) {
    expect(() => parseWordPage({ ...page, ...changed }, identity)).toThrow();
  }
  expect(() => parseWordPage({ ...page, reference_language_id: 'de' }, identity)).toThrow(
    FeedSettingsChanged,
  );
  expect(() => parseWordPage({ ...page, items: [], has_more: true }, identity)).toThrow();
});
it('pins the JWT and sends only bounded search and exact original cursor values', async () => {
  response({ ...envelope, items: [item], has_more: false });
  const signal = new AbortController().signal;
  const gateway = exploreGateway(identity);
  await gateway.words('chien', { term: 'le chat', id }, signal);
  expect(mockRpc).toHaveBeenCalledWith('search_vocabulary_terms', {
    query: 'chien',
    before_term: 'le chat',
    before_id: id,
    page_size: 20,
  });
  expect(mockAbort).toHaveBeenCalledWith(signal);
  expect(await mockCreate.mock.calls[0][2].accessToken()).toBe('pinned-token');
  expect(mockCreate.mock.calls[0][2].auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
});
it('accepts an unavailable concept and rejects a different concept response', () => {
  expect(parseExploreConcept({ ...envelope, item: null }, identity, id)).toBeNull();
  expect(parseExploreConcept({ ...envelope, item }, identity, id)?.conceptId).toBe(id);
  expect(() =>
    parseExploreConcept({ ...envelope, item }, identity, '83000000-0000-4000-8000-000000000002'),
  ).toThrow();
});
it('loads only the selected concept and preserves denied public eligibility for cache retirement', async () => {
  response({ ...envelope, items: [], has_more: false });
  const signal = new AbortController().signal;
  const examples = exploreGateway(identity).examples(id);
  await examples.load({ time: '2026-09-22T10:00:00.123456Z', id }, signal);
  expect(mockRpc).toHaveBeenCalledWith('get_concept_submissions', {
    concept_id: id,
    before_time: '2026-09-22T10:00:00.123456Z',
    before_id: id,
    page_size: 12,
  });
  response(null, { code: '42501' });
  await expect(examples.load(null, signal)).rejects.toBeInstanceOf(RatingUnavailable);
  await expect(exploreGateway(identity).words('chien', null, signal)).rejects.toBeInstanceOf(
    SafetyUnavailable,
  );
});
it('parses People relationship state without loading individual profiles and rejects self-follow', async () => {
  const row = { id, username: 'learner', avatar_id: null, is_self: false, is_following: true };
  response({ viewer_id: 'viewer', items: [row], has_more: false });
  const page = await socialGateway(identity).search('lea', null, new AbortController().signal);
  expect(page.items[0]).toMatchObject({ isSelf: false, isFollowing: true });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  response({ viewer_id: 'viewer', items: [{ ...row, is_self: true }], has_more: false });
  await expect(
    socialGateway(identity).search('lea', null, new AbortController().signal),
  ).rejects.toThrow('Invalid self relationship');
});
