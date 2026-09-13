import type { Database } from '../../../src/types/database.ts';

type Target = Database['public']['Functions']['get_discover_photo_targets']['Returns'][number];
type SignedPhoto = { path?: string | null; signedUrl?: string | null; error?: string | null };

// Only this explicit projection can leave the service-role signing path.
export function projectFeedPhotos(targets: Target[], signed: SignedPhoto[]) {
  return targets.map((row) => {
    const photo = signed.find((item) => item.path === row.storage_path);
    // Absence from the eligible target query means denied/unavailable. A missing
    // Storage signature for an eligible target is instead a recoverable failure.
    // Silently omitting it would advance the client's cursor past an unseen card.
    if (!photo?.signedUrl || photo.error) throw new Error('feed_signing_failed');
    const uri = new URL(photo.signedUrl);
    return {
      id: row.id,
      target_term: row.target_term,
      reference_term: row.reference_term,
      cefr_level: row.cefr_level,
      username: row.username,
      submitted_at: row.submitted_at,
      signed_path: uri.pathname + uri.search,
    };
  });
}
