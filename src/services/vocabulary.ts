import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { isCefrLevel, type CefrLevel } from '@/features/onboarding/validation';
import { publicConfig } from '@/lib/env';
import type { Database } from '@/types/database';
import { PHOTO_BUCKET } from './submissions';

export type Capture = {
  id: string;
  conceptId: string;
  assignmentId: string;
  targetTerm: string;
  referenceTerm: string;
  cefrLevel: CefrLevel;
  submittedAt: string;
  visibility: 'private' | 'public';
  captureCount: number;
};
export type HistoryCursor = { time: string; id: string };
export type VocabularyPage = {
  items: Capture[];
  totalConcepts: number;
  concept: Capture | null;
  hasMore: boolean;
};
export type VocabularyQuery = { conceptId?: string; search: string; level: string };
export type VocabularyGateway = {
  load: (cursor: HistoryCursor | null, signal?: AbortSignal) => Promise<VocabularyPage>;
  previews: (ids: string[], signal?: AbortSignal) => Promise<Record<string, string | null>>;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid vocabulary response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid vocabulary response.');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid vocabulary response.');
  return value;
}
function capture(value: unknown): Capture {
  const row = record(value),
    level = text(row.cefr_level);
  if (
    !isCefrLevel(level) ||
    !['private', 'public'].includes(text(row.visibility)) ||
    !Number.isFinite(Date.parse(text(row.submitted_at))) ||
    count(row.capture_count) < 1
  )
    throw new Error('Invalid vocabulary response.');
  return {
    id: text(row.id),
    conceptId: text(row.concept_id),
    assignmentId: text(row.assignment_id),
    targetTerm: text(row.target_term),
    referenceTerm: text(row.reference_term),
    cefrLevel: level,
    submittedAt: text(row.submitted_at),
    visibility: row.visibility === 'public' ? 'public' : 'private',
    captureCount: count(row.capture_count),
  };
}
export function parseVocabularyPage(
  value: unknown,
  userId: string,
  conceptId?: string,
): VocabularyPage {
  const row = record(value);
  if (row.user_id !== userId) throw new Error('Vocabulary account changed.');
  if (!Array.isArray(row.items) || row.items.length > 24 || typeof row.has_more !== 'boolean')
    throw new Error('Invalid vocabulary response.');
  const items = row.items.map(capture);
  const concept = row.concept === null ? null : capture(row.concept);
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    (conceptId &&
      (items.some((item) => item.conceptId !== conceptId) ||
        (concept && concept.conceptId !== conceptId)))
  )
    throw new Error('Vocabulary concept changed.');
  return { items, concept, totalConcepts: count(row.total_concepts), hasMore: row.has_more };
}
export function parseVocabularyPreviews(
  value: unknown,
  userId: string,
  ids: string[],
  apiUrl: string,
) {
  const rows = record(value).previews;
  if (!Array.isArray(rows) || rows.length !== ids.length)
    throw new Error('Invalid photo response.');
  const result: Record<string, string | null> = {};
  for (const value of rows) {
    const row = record(value),
      id = text(row.id);
    if (!ids.includes(id) || Object.hasOwn(result, id)) throw new Error('Invalid photo response.');
    if (row.signedPath === null) {
      result[id] = null;
      continue;
    }
    const path = text(row.signedPath);
    const prefix = `/storage/v1/object/sign/${PHOTO_BUCKET}/${userId}/${id}.jpg?token=`;
    if (!path.startsWith(prefix) || !/^[A-Za-z0-9_.-]+$/.test(path.slice(prefix.length)))
      throw new Error('Invalid photo response.');
    result[id] = apiUrl + path;
  }
  return result;
}
export function vocabularyGateway(
  userId: string,
  token: string,
  query: VocabularyQuery,
): VocabularyGateway {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async load(cursor, signal) {
      const request = client.rpc('get_my_vocabulary', {
        requested_concept: query.conceptId,
        search_text: query.search,
        requested_level: query.level || undefined,
        before_time: cursor?.time,
        before_id: cursor?.id,
        page_size: 12,
      });
      if (signal) request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return parseVocabularyPage(data, userId, query.conceptId);
    },
    async previews(ids, signal) {
      if (!ids.length) return {};
      const { data, error } = await client.functions.invoke('photo-authority', {
        body: { action: 'previews', submissionIds: ids },
        signal,
      });
      if (error) throw error;
      return parseVocabularyPreviews(data, userId, ids, config.url);
    },
  };
}
