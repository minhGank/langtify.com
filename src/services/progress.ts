import { requireSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export type ProgressIdentity = { userId: string; accessToken: string };
export type Progress = {
  completedWords: number;
  totalXp: number;
  level: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  currentStreak: number;
  longestStreak: number;
  totalWordsCompleted: number;
  totalChallengesCompleted: number;
};
export type XpReceipt = { wordXp: number; challengeBonusXp: number; milestoneXp: number };
function record(data: Json, userId: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.user_id !== userId)
    throw new Error('Progress account changed.');
  return data;
}
function count(value: Json | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid progress response.');
  return value;
}
export function parseProgress(data: Json, userId: string, challengeId?: string): Progress {
  const row = record(data, userId);
  if (challengeId && row.challenge_id !== challengeId) throw new Error('Challenge changed.');
  const progress = {
    completedWords: count(row.completed_words),
    totalXp: count(row.total_xp),
    level: count(row.level),
    nextLevelXp: count(row.next_level_xp),
    xpIntoLevel: count(row.xp_into_level),
    xpForNextLevel: count(row.xp_for_next_level),
    currentStreak: count(row.current_streak),
    longestStreak: count(row.longest_streak),
    totalWordsCompleted: count(row.total_words_completed),
    totalChallengesCompleted: count(row.total_challenges_completed),
  };
  if (
    progress.completedWords > 3 ||
    progress.xpForNextLevel === 0 ||
    progress.xpIntoLevel >= progress.xpForNextLevel
  )
    throw new Error('Invalid progress response.');
  return progress;
}
export function progressGateway(identity: ProgressIdentity, challengeId?: string) {
  return async (): Promise<Progress> => {
    const { data, error } = await requireSupabase()
      .rpc('get_my_progress', { challenge_id: challengeId })
      .setHeader('Authorization', `Bearer ${identity.accessToken}`);
    if (error) throw error;
    return parseProgress(data, identity.userId, challengeId);
  };
}
export function receiptGateway(identity: ProgressIdentity, submissionId: string) {
  return async (): Promise<XpReceipt> => {
    const { data, error } = await requireSupabase()
      .rpc('get_submission_xp', { submission_id: submissionId })
      .setHeader('Authorization', `Bearer ${identity.accessToken}`);
    if (error) throw error;
    const row = record(data, identity.userId);
    if (row.submission_id !== submissionId) throw new Error('Submission changed.');
    return {
      wordXp: count(row.word_xp),
      challengeBonusXp: count(row.challenge_bonus_xp),
      milestoneXp: count(row.milestone_xp),
    };
  };
}
