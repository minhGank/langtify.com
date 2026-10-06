import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import type { Kind, Store } from './worker.ts';
const bucket = (kind: Kind) =>
  kind === 'submissions' ? 'challenge-submissions' : 'profile-avatars';
export function cleanupStore(client: SupabaseClient<Database>): Store {
  return {
    async begin(request_id) {
      const { data, error } = await client.rpc('begin_storage_cleanup_run', {
        request_id,
        runner_name: 'edge',
      });
      if (error) throw new Error('Lease unavailable');
      return data;
    },
    async claim(kind) {
      const { data, error } = await client.rpc(
        kind === 'submissions' ? 'claim_photo_cleanup' : 'claim_avatar_cleanup',
        { batch_size: 100 },
      );
      if (error || !data) throw new Error('Claim failed');
      return data.map((row) => row.storage_path);
    },
    async remove(kind, path) {
      const { error } = await client.storage.from(bucket(kind)).remove([path]);
      if (error) throw new Error('Removal failed');
    },
    async finish(kind, object_path) {
      const { error } = await client.rpc(
        kind === 'submissions' ? 'finish_photo_cleanup' : 'finish_avatar_cleanup',
        { object_path },
      );
      if (error) throw new Error('Finish failed');
    },
    async complete(request_id, counts, uncertain) {
      const { data, error } = await client.rpc('finish_storage_cleanup_run', {
        request_id,
        counts,
        uncertain,
      });
      if (error) throw new Error('Record failed');
      return data;
    },
  };
}
