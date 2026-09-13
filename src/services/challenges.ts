import { requireSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { isCefrLevel } from '@/features/onboarding/validation';

export const challengeSlots = ['review', 'target', 'stretch'] as const;
export type ChallengeSlot = (typeof challengeSlots)[number];
export type ChallengeWord = {
  id: string;
  slot: ChallengeSlot;
  cefrLevel: string;
  conceptId: string;
  targetTerm: string;
  referenceTerm: string;
  submission: { id: string; status: 'pending' | 'completed' | 'deleting' } | null;
};
export type TodayChallenge = {
  id: string;
  localDate: string;
  timezone: string;
  words: ChallengeWord[];
};
export type ChallengeIdentity = { userId: string; learningId: string; accessToken: string };
export type ChallengeGateway = {
  load: () => Promise<TodayChallenge>;
  replace: (assignmentId: string) => Promise<TodayChallenge>;
};
function object(value: Json | undefined): { [key: string]: Json | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid challenge response.');
  return value;
}
function text(value: Json | undefined): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid challenge response.');
  return value;
}
export function parseChallenge(
  data: Json,
  identity: Pick<ChallengeIdentity, 'userId' | 'learningId'>,
): TodayChallenge {
  const payload = object(data);
  const challenge = object(payload.challenge);
  if (
    challenge.user_id !== identity.userId ||
    challenge.user_language_profile_id !== identity.learningId
  ) {
    throw new Error('Challenge account changed.');
  }
  const id = text(challenge.id);
  const words = payload.words;
  if (!Array.isArray(words) || words.length !== 3)
    throw new Error('Incomplete challenge response.');
  const cards = words.map((value): ChallengeWord => {
    const word = object(value);
    const slot = challengeSlots.find((slot) => slot === word.slot);
    if (
      !slot ||
      typeof word.cefr_level !== 'string' ||
      !isCefrLevel(word.cefr_level) ||
      word.daily_challenge_id !== id ||
      word.replaced_at !== null
    ) {
      throw new Error('Invalid challenge assignment.');
    }
    const saved = word.submission == null ? null : object(word.submission);
    let submission: ChallengeWord['submission'] = null;
    if (saved) {
      if (saved.status !== 'pending' && saved.status !== 'completed' && saved.status !== 'deleting')
        throw new Error('Invalid submission state.');
      submission = { id: text(saved.id), status: saved.status };
    }
    return {
      id: text(word.id),
      slot,
      cefrLevel: word.cefr_level,
      conceptId: text(word.concept_id),
      targetTerm: text(word.target_term),
      referenceTerm: text(word.reference_term),
      submission,
    };
  });
  if (
    new Set(cards.map((word) => word.slot)).size !== 3 ||
    new Set(cards.map((word) => word.conceptId)).size !== 3
  ) {
    throw new Error('Duplicate challenge assignment.');
  }
  return {
    id,
    localDate: text(challenge.local_challenge_date),
    timezone: text(challenge.timezone),
    words: cards.sort((a, b) => challengeSlots.indexOf(a.slot) - challengeSlots.indexOf(b.slot)),
  };
}
export function challengeGateway(identity: ChallengeIdentity): ChallengeGateway {
  return {
    async load() {
      const { data, error } = await requireSupabase()
        .rpc('get_or_create_today_challenge')
        .setHeader('Authorization', `Bearer ${identity.accessToken}`);
      if (error) throw error;
      return parseChallenge(data, identity);
    },
    async replace(assignmentId) {
      const { data, error } = await requireSupabase()
        .rpc('replace_daily_challenge_word', { active_assignment_id: assignmentId })
        .setHeader('Authorization', `Bearer ${identity.accessToken}`);
      if (error) throw error;
      return parseChallenge(data, identity);
    },
  };
}
