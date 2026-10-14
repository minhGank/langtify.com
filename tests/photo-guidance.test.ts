import { parsePhotoGuidance } from '@/services/photo-guidance';
import { parseChallenge } from '@/services/challenges';
import { makeChallengePayload } from './challenge-fixtures';
import { makeSession } from './fixtures';
const guidanceRow = {
  concept_id: 'concept-review',
  locale: 'en',
  primary_idea: 'Stage a simple scene.',
  representation_mode: 'interpretive',
  alternative_idea: 'Use paper figures.',
  alternative_mode: 'interpretive',
  accessibility_guidance: 'You can sit down.',
  safety_guidance: 'Use your own props. No strangers needed.',
};
it('parses complete localized help and preserves distinct alternative mode', () => {
  expect(parsePhotoGuidance(guidanceRow, 'concept-review')).toMatchObject({
    locale: 'en',
    mode: 'interpretive',
    safety: guidanceRow.safety_guidance,
  });
  expect(
    parsePhotoGuidance(
      { ...guidanceRow, locale: 'fr', alternative_mode: 'literal' },
      'concept-review',
    ),
  ).toMatchObject({ locale: 'fr', alternativeMode: 'literal' });
  expect(
    parsePhotoGuidance(
      { ...guidanceRow, alternative_idea: null, alternative_mode: null },
      'concept-review',
    )?.alternativeIdea,
  ).toBeNull();
});
it.each([
  undefined,
  null,
  {},
  { ...guidanceRow, concept_id: 'other' },
  { ...guidanceRow, safety_guidance: '' },
  { ...guidanceRow, locale: 'xx' },
  { ...guidanceRow, primary_idea: 'x'.repeat(2001) },
  { ...guidanceRow, alternative_mode: null },
])('omits malformed help without breaking the challenge: %p', (value) => {
  expect(parsePhotoGuidance(value, 'concept-review')).toBeNull();
});
it('attaches help only to its own concept and accepts legacy payloads', () => {
  const payload = makeChallengePayload();
  const identity = { userId: makeSession().user.id, learningId: 'learning-id' };
  expect(parseChallenge(payload, identity).words[0].photoGuidance).toBeNull();
  const result = parseChallenge(
    { ...payload, words: payload.words.map((w) => ({ ...w, photo_guidance: guidanceRow })) },
    identity,
  );
  expect(result.words[0].photoGuidance?.primaryIdea).toBe(guidanceRow.primary_idea);
  expect(result.words[1].photoGuidance).toBeNull();
});
