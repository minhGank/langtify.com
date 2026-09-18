import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { isCefrLevel, type CefrLevel } from '@/features/onboarding/validation';
import { publicConfig } from '@/lib/env';
import type { Database } from '@/types/database';
import {
  parseRatingSummary,
  RatingUnavailable,
  type RatingScore,
  type RatingSummary,
} from '@/features/ratings/rating';

export type FeedItem = RatingSummary & {
  id: string;
  targetTerm: string;
  referenceTerm: string;
  cefrLevel: CefrLevel;
  username: string;
  submittedAt: string;
};
export type FeedCursor = { time: string; id: string };
export type FeedPage = { items: FeedItem[]; hasMore: boolean };
export type FeedPhotos = { items: FeedItem[]; photos: Record<string, string> };
export type FeedGateway = {
  rate: (id: string, score: RatingScore, signal?: AbortSignal) => Promise<RatingSummary>;
  load: (cursor: FeedCursor | null, signal?: AbortSignal) => Promise<FeedPage>;
  previews: (ids: string[], signal?: AbortSignal) => Promise<FeedPhotos>;
};
export type FeedIdentity = { userId: string; targetLanguageId: string; token: string };
export class FeedSettingsChanged extends Error {}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid feed response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid feed response.');
  return value;
}
function payload(value: unknown, identity: FeedIdentity) {
  const row = record(value);
  if (row.viewer_id !== identity.userId) throw new Error('Feed account changed.');
  if (row.target_language_id !== identity.targetLanguageId)
    throw new FeedSettingsChanged('Your learning settings changed. Reload your account.');
  if (!Array.isArray(row.items) || row.items.length > 24) throw new Error('Invalid feed response.');
  const items = row.items.map((item): FeedItem => {
    const r = record(item),
      level = text(r.cefr_level),
      submittedAt = text(r.submitted_at);
    if (!isCefrLevel(level) || !Number.isFinite(Date.parse(submittedAt)))
      throw new Error('Invalid feed response.');
    return {
      ...parseRatingSummary(r),
      id: text(r.id),
      targetTerm: text(r.target_term),
      referenceTerm: text(r.reference_term),
      cefrLevel: level,
      username: text(r.username),
      submittedAt,
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Duplicate feed item.');
  return { row, items };
}
export function parseFeedPage(value: unknown, identity: FeedIdentity): FeedPage {
  const { row, items } = payload(value, identity);
  if (typeof row.has_more !== 'boolean' || (row.has_more && !items.length))
    throw new Error('Invalid feed response.');
  return { items, hasMore: row.has_more };
}
export function parseFeedPhotos(
  value: unknown,
  identity: FeedIdentity,
  ids: string[],
  apiUrl: string,
): FeedPhotos {
  const { row, items } = payload(value, identity);
  const photos: Record<string, string> = {};
  // The payload validator bounds and validates the parallel rows; parse fields again
  // without accepting an arbitrary origin, bucket, file or URL options.
  const rows = row.items;
  if (!Array.isArray(rows)) throw new Error('Invalid feed response.');
  for (const raw of rows) {
    const item = record(raw),
      id = text(item.id),
      path = text(item.signed_path);
    const match =
      /^\/storage\/v1\/object\/sign\/challenge-submissions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/([0-9a-f-]{36})\.jpg\?token=[A-Za-z0-9_.-]+$/.exec(
        path,
      );
    if (!ids.includes(id) || !match || match[1] !== id) throw new Error('Invalid feed photo.');
    photos[id] = apiUrl + path;
  }
  return { items, photos };
}
export function parseRatingReceipt(
  value: unknown,
  identity: FeedIdentity,
  id: string,
): RatingSummary {
  const row = record(value);
  if (row.viewer_id !== identity.userId) throw new Error('Rating account changed.');
  if (row.target_language_id !== identity.targetLanguageId)
    throw new FeedSettingsChanged('Your learning settings changed. Reload your account.');
  const item = record(row.item);
  if (item.id !== id) throw new Error('Rating submission changed.');
  return parseRatingSummary(item);
}
export function feedGateway(identity: FeedIdentity): FeedGateway {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async rate(id, score, signal) {
      const request = client.rpc('rate_submission', { submission_id: id, score });
      if (signal) request.abortSignal(signal);
      const { data, error } = await request;
      if (error?.code === '42501') throw new RatingUnavailable('Photo is unavailable for rating.');
      if (error) throw error;
      return parseRatingReceipt(data, identity, id);
    },
    async load(cursor, signal) {
      const request = client.rpc('get_discover_feed', {
        before_time: cursor?.time,
        before_id: cursor?.id,
        page_size: 12,
      });
      if (signal) request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return parseFeedPage(data, identity);
    },
    async previews(ids, signal) {
      if (!ids.length) return { items: [], photos: {} };
      const { data, error } = await client.functions.invoke('photo-authority', {
        body: {
          action: 'feed-previews',
          submissionIds: ids,
          targetLanguageId: identity.targetLanguageId,
        },
        signal,
      });
      if (error) throw error;
      return parseFeedPhotos(data, identity, ids, config.url);
    },
  };
}
