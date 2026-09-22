import { createServerCache } from '@/lib/server-cache';
import type { PastWordsCursor, PastWordsPage } from '@/services/past-words';

export type PastWordsWindow = PastWordsPage & {
  cursor: PastWordsCursor | null;
  fromStart: boolean;
};
export const pastWordsCache = createServerCache<PastWordsWindow>({ maxEntries: 8 });

export function pastWordsWindow(page: PastWordsPage): PastWordsWindow {
  const last = page.items.at(-1);
  return {
    ...page,
    fromStart: true,
    cursor: last
      ? { captured: last.hasCapture, date: last.challengeDate, id: last.assignmentId }
      : null,
  };
}
