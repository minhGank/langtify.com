import { createClient } from '@supabase/supabase-js';
import { isCefrLevel, type CefrLevel } from '@/features/onboarding/validation';
import {
  envelope,
  flag,
  identifier,
  record,
  SafetyUnavailable,
  text,
} from '@/features/safety/model';
import { publicConfig } from '@/lib/env';
import { boundedFetch } from '@/lib/http';
import type { Database } from '@/types/database';
import { RatingUnavailable } from '@/features/ratings/rating';
import {
  feedGateway,
  FeedSettingsChanged,
  parseFeedPage,
  type FeedGateway,
  type FeedIdentity,
} from './discover';

export type ExploreIdentity = FeedIdentity & { referenceLanguageId: string };
export type ExploreWord = {
  conceptId: string;
  targetTerm: string;
  referenceTerm: string;
  cefrLevel: CefrLevel;
};
export type WordCursor = { term: string; id: string };
export type WordPage = { items: ExploreWord[]; hasMore: boolean };

function context(value: unknown, identity: ExploreIdentity) {
  const row = envelope(value, identity);
  if (
    row.target_language_id !== identity.targetLanguageId ||
    row.reference_language_id !== identity.referenceLanguageId
  )
    throw new FeedSettingsChanged('Your learning settings changed. Reload your account.');
  return row;
}
function word(value: unknown): ExploreWord {
  const row = record(value),
    level = text(row.cefr_level),
    targetTerm = text(row.target_term),
    referenceTerm = text(row.reference_term);
  if (!isCefrLevel(level) || !targetTerm.trim() || !referenceTerm.trim())
    throw new Error('Invalid vocabulary response.');
  return { conceptId: identifier(row.concept_id), targetTerm, referenceTerm, cefrLevel: level };
}
export function parseWordPage(value: unknown, identity: ExploreIdentity): WordPage {
  const row = context(value, identity);
  if (!Array.isArray(row.items) || row.items.length > 20)
    throw new Error('Invalid vocabulary page.');
  const items = row.items.map(word),
    hasMore = flag(row.has_more);
  if (
    new Set(items.map((item) => item.conceptId)).size !== items.length ||
    (hasMore && !items.length)
  )
    throw new Error('Invalid vocabulary page.');
  return { items, hasMore };
}
export function parseExploreConcept(
  value: unknown,
  identity: ExploreIdentity,
  conceptId: string,
): ExploreWord | null {
  const row = context(value, identity);
  if (row.item === null) return null;
  const item = word(row.item);
  if (item.conceptId !== conceptId) throw new Error('Vocabulary concept changed.');
  return item;
}
export function exploreGateway(identity: ExploreIdentity) {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  async function receive(request: PromiseLike<{ data: unknown; error: { code?: string } | null }>) {
    const result = await request;
    if (result.error?.code === '42501') throw new SafetyUnavailable('Search is unavailable.');
    if (result.error) throw new Error('Search could not be loaded.');
    return result.data;
  }
  return {
    async words(query: string, cursor: WordCursor | null, signal: AbortSignal) {
      return parseWordPage(
        await receive(
          client
            .rpc('search_vocabulary_terms', {
              query,
              before_term: cursor?.term,
              before_id: cursor?.id,
              page_size: 20,
            })
            .abortSignal(signal),
        ),
        identity,
      );
    },
    async concept(conceptId: string, signal: AbortSignal) {
      return parseExploreConcept(
        await receive(
          client.rpc('get_explore_concept', { concept_id: conceptId }).abortSignal(signal),
        ),
        identity,
        conceptId,
      );
    },
    examples(conceptId: string): FeedGateway {
      const feed = feedGateway(identity);
      return {
        ...feed,
        async load(cursor, signal) {
          const request = client.rpc('get_concept_submissions', {
            concept_id: conceptId,
            before_time: cursor?.time,
            before_id: cursor?.id,
            page_size: 12,
          });
          if (signal) request.abortSignal(signal);
          try {
            return parseFeedPage(await receive(request), identity);
          } catch (cause) {
            if (cause instanceof SafetyUnavailable)
              throw new RatingUnavailable('Public photos are unavailable.');
            throw cause;
          }
        },
      };
    },
  };
}
