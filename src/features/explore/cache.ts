import { createServerCache } from '@/lib/server-cache';
import type { ExploreWord, WordCursor, WordPage } from '@/services/explore';

export type WordWindow = WordPage & { cursor: WordCursor | null; fromStart: boolean };
export const wordsCache = createServerCache<WordWindow>({ maxEntries: 8 });
export const conceptCache = createServerCache<{ item: ExploreWord | null }>({ maxEntries: 8 });
