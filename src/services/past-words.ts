import { createClient } from '@supabase/supabase-js';
import { isCefrLevel, type CefrLevel } from '@/features/onboarding/validation';
import { flag, identifier, record, text } from '@/features/safety/model';
import { publicConfig } from '@/lib/env';
import { boundedFetch } from '@/lib/http';
import type { Database } from '@/types/database';

export type PastWordsIdentity = { userId: string; token: string; timezone: string };
export type PastWord = {
  assignmentId: string;
  conceptId: string;
  challengeDate: string;
  targetTerm: string;
  referenceTerm: string;
  cefrLevel: CefrLevel;
  hasCapture: boolean;
  submissionId: string | null;
  submissionStatus: 'pending' | 'completed' | 'deleting' | null;
  captureKind: 'daily' | 'historical' | null;
};
export type PastWordsCursor = { captured: boolean; date: string; id: string };
export type PastWordsPage = { currentLocalDate: string; items: PastWord[]; hasMore: boolean };
export type PastWordsQuery = { search: string; level: CefrLevel | '' };
export class PastWordsUnavailable extends Error {}

function calendarDate(value: unknown) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid challenge date.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error('Invalid challenge date.');
  return date;
}
function word(value: unknown, currentLocalDate: string): PastWord {
  const row = record(value),
    cefrLevel = text(row.cefr_level),
    targetTerm = text(row.target_term),
    referenceTerm = text(row.reference_term),
    challengeDate = calendarDate(row.challenge_date),
    hasCapture = flag(row.has_capture),
    submissionStatus = row.submission_status,
    captureKind = row.capture_kind,
    submissionId = row.submission_id === null ? null : identifier(row.submission_id);
  if (
    !isCefrLevel(cefrLevel) ||
    !targetTerm.trim() ||
    !referenceTerm.trim() ||
    challengeDate >= currentLocalDate ||
    (submissionStatus !== null &&
      submissionStatus !== 'pending' &&
      submissionStatus !== 'completed' &&
      submissionStatus !== 'deleting') ||
    (captureKind !== null && captureKind !== 'daily' && captureKind !== 'historical') ||
    (submissionId === null) !== (submissionStatus === null) ||
    (submissionId === null) !== (captureKind === null) ||
    (submissionStatus === 'completed' && !hasCapture) ||
    (hasCapture && submissionStatus !== 'completed' && submissionStatus !== 'deleting')
  )
    throw new Error('Invalid past word.');
  return {
    assignmentId: identifier(row.assignment_id),
    conceptId: identifier(row.concept_id),
    challengeDate,
    targetTerm,
    referenceTerm,
    cefrLevel,
    hasCapture,
    submissionId,
    submissionStatus,
    captureKind,
  };
}
export function parsePastWordsPage(value: unknown, userId: string): PastWordsPage {
  const row = record(value);
  if (row.user_id !== userId) throw new PastWordsUnavailable('Your account changed.');
  const currentLocalDate = calendarDate(row.current_local_date);
  if (!Array.isArray(row.items) || row.items.length > 20)
    throw new Error('Invalid past words page.');
  const items = row.items.map((value) => word(value, currentLocalDate)),
    hasMore = flag(row.has_more);
  if (
    new Set(items.map((item) => item.assignmentId)).size !== items.length ||
    (hasMore && !items.length)
  )
    throw new Error('Invalid past words page.');
  return { currentLocalDate, items, hasMore };
}
export function pastWordsGateway(identity: PastWordsIdentity) {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async load(query: PastWordsQuery, cursor: PastWordsCursor | null, signal: AbortSignal) {
      const { data, error } = await client
        .rpc('get_my_past_words', {
          search_text: query.search,
          requested_level: query.level || undefined,
          before_captured: cursor?.captured,
          before_date: cursor?.date,
          before_id: cursor?.id,
          page_size: 20,
        })
        .abortSignal(signal);
      if (error?.code === '42501') throw new PastWordsUnavailable('Past words are unavailable.');
      if (error) throw new Error('Past words could not be loaded.');
      return parsePastWordsPage(data, identity.userId);
    },
  };
}
