import { challengeGateway, parseChallenge } from '@/services/challenges';
import { makeChallengePayload } from './challenge-fixtures';
import { makeSession } from './fixtures';
import { createServerCache, serverScope } from '@/lib/server-cache';
const mockHeader = jest.fn();
const mockRpc = jest.fn(() => ({ setHeader: mockHeader }));
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: mockRpc }) }));
const identity = {
  userId: makeSession().user.id,
  learningId: 'learning-id',
  accessToken: 'captured-token',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockHeader.mockResolvedValue({ data: makeChallengePayload(), error: null });
});
it('resolves backend target/reference cards in slot order', () => {
  const payload = makeChallengePayload();
  payload.words.reverse();
  const challenge = parseChallenge(payload, identity);
  expect(challenge.words.map((word) => word.slot)).toEqual(['review', 'target', 'stretch']);
  expect(challenge.words[0]).toMatchObject({
    targetTerm: 'la fenêtre',
    referenceTerm: 'window',
    cefrLevel: 'A2',
  });
});
it('sends no client identity, date or configuration when generating', async () => {
  await challengeGateway(identity).load();
  expect(mockRpc).toHaveBeenCalledWith('get_or_create_today_challenge');
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer captured-token');
});
it.each(['daily', 'historical'] as const)(
  'preserves authoritative %s capture semantics when a submission appears in Today',
  (captureKind) => {
    const payload = makeChallengePayload();
    const result = parseChallenge(
      {
        ...payload,
        words: payload.words.map((word, index) => ({
          ...word,
          submission:
            index === 0
              ? { id: 'saved-photo', status: 'completed', capture_kind: captureKind }
              : null,
        })),
      },
      identity,
    );
    expect(result.words[0].submission).toEqual({
      id: 'saved-photo',
      status: 'completed',
      captureKind,
    });
  },
);
it.each([null, '', 'library', 'DAILY'])(
  'rejects ambiguous capture kind %p rather than inferring daily credit',
  (captureKind) => {
    const payload = makeChallengePayload();
    expect(() =>
      parseChallenge(
        {
          ...payload,
          words: payload.words.map((word) => ({
            ...word,
            submission: { id: 'saved-photo', status: 'completed', capture_kind: captureKind },
          })),
        },
        identity,
      ),
    ).toThrow('Invalid submission state');
  },
);
it('invalidates only the current session inbox once when authoritative daily words become ready', async () => {
  const cache = createServerCache<number>();
  const own = cache.entry(`${serverScope(identity.userId, identity.accessToken)}:inbox`, ['inbox']);
  const other = cache.entry('another:session:inbox', ['inbox']);
  own.set(0);
  other.set(4);
  await challengeGateway(identity).load();
  expect(own.getSnapshot().invalidation).toBe(1);
  expect(other.getSnapshot().invalidation).toBe(0);
  await challengeGateway(identity).load();
  await challengeGateway(identity).replace('assignment-review');
  expect(own.getSnapshot().invalidation).toBe(1);
});
it('sends only the active assignment ID for replacement and pins the session', async () => {
  await challengeGateway(identity).replace('assignment-review');
  expect(mockRpc).toHaveBeenCalledWith('replace_daily_challenge_word', {
    active_assignment_id: 'assignment-review',
  });
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer captured-token');
});
it('rejects responses belonging to another account or learning profile', () => {
  expect(() => parseChallenge(makeChallengePayload('other'), identity)).toThrow(
    'Challenge account changed',
  );
  expect(() =>
    parseChallenge(makeChallengePayload(identity.userId, 'other-profile'), identity),
  ).toThrow('Challenge account changed');
});
it('rejects incomplete, duplicate and retired assignments', () => {
  const missing = makeChallengePayload();
  missing.words.pop();
  expect(() => parseChallenge(missing, identity)).toThrow('Incomplete');
  const duplicate = makeChallengePayload();
  duplicate.words[1].concept_id = duplicate.words[0].concept_id;
  expect(() => parseChallenge(duplicate, identity)).toThrow('Duplicate');
  const retired = makeChallengePayload();
  expect(() =>
    parseChallenge(
      {
        ...retired,
        words: retired.words.map((word) => ({ ...word, replaced_at: '2026-09-12T12:00:00Z' })),
      },
      identity,
    ),
  ).toThrow('Invalid challenge assignment');
  const duplicateSlot = makeChallengePayload();
  duplicateSlot.words[1].slot = 'review';
  expect(() => parseChallenge(duplicateSlot, identity)).toThrow('Duplicate');
  const malformed = { ...makeChallengePayload(), words: null };
  expect(() => parseChallenge(malformed, identity)).toThrow('Incomplete');
});
it('propagates controlled backend failures without inventing a challenge', async () => {
  mockHeader.mockResolvedValue({ data: null, error: { message: 'insufficient_vocabulary' } });
  await expect(challengeGateway(identity).load()).rejects.toEqual({
    message: 'insufficient_vocabulary',
  });
});
