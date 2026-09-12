import { challengeSlots, parseChallenge } from '@/services/challenges';
import { makeSession } from './fixtures';
export function makeChallengePayload(userId = makeSession().user.id, learningId = 'learning-id') {
  return {
    challenge: {
      id: 'challenge-id',
      user_id: userId,
      user_language_profile_id: learningId,
      local_challenge_date: '2026-09-12',
      timezone: 'America/Toronto',
    },
    words: challengeSlots.map((slot, index) => ({
      id: `assignment-${slot}`,
      daily_challenge_id: 'challenge-id',
      slot,
      cefr_level: ['A2', 'B1', 'B2'][index],
      concept_id: `concept-${slot}`,
      target_term: ['la fenêtre', 'un embouteillage', 'bondé'][index],
      reference_term: ['window', 'traffic jam', 'crowded'][index],
      replaced_at: null,
    })),
  };
}
export function makeChallenge(userId = makeSession().user.id, learningId = 'learning-id') {
  return parseChallenge(makeChallengePayload(userId, learningId), { userId, learningId });
}
