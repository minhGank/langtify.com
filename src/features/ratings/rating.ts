export const ratingOptions = [
  { score: 1, label: 'Not related' },
  { score: 2, label: 'Poor match' },
  { score: 3, label: 'Understandable' },
  { score: 4, label: 'Clear match' },
  { score: 5, label: 'Perfect match' },
] as const;
export type RatingScore = (typeof ratingOptions)[number]['score'];
export function isRatingScore(value: unknown): value is RatingScore {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}
export type RatingSummary = {
  averageRating: number | null;
  ratingCount: number;
  viewerRating: RatingScore | null;
  canRate: boolean;
};
export type RatingAction = { id: string; score: RatingScore; status: 'saving' | 'error' };
export class RatingUnavailable extends Error {}
export function parseRatingSummary(row: Record<string, unknown>): RatingSummary {
  const count = row.rating_count,
    average = row.average_rating,
    own = row.viewer_rating;
  if (
    average !== null &&
    (typeof average !== 'number' || !Number.isFinite(average) || average < 1 || average > 5)
  )
    throw new Error('Invalid rating summary.');
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (count === 0 ? average !== null : average === null) ||
    (own !== null && !isRatingScore(own)) ||
    (count === 0 && own !== null) ||
    typeof row.can_rate !== 'boolean' ||
    (!row.can_rate && own !== null)
  ) {
    throw new Error('Invalid rating summary.');
  }
  return {
    averageRating: average,
    ratingCount: count,
    viewerRating: own,
    canRate: row.can_rate,
  };
}
