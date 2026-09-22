import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/env';
import { boundedFetch } from '@/lib/http';
import type { Database } from '@/types/database';
import {
  envelope,
  flag,
  identifier,
  parsePage,
  record,
  text,
  timestamp,
  SafetyUnavailable,
  type SafetyIdentity,
} from '@/features/safety/model';
import { parsePublicProfile, type PublicProfile } from './social';

export type ConnectionKind = 'followers' | 'following';
export type Connection = {
  id: string;
  username: string;
  avatarId: string | null;
  isSelf: boolean;
  isFollowing: boolean;
  followedAt: string;
};
export type ConnectionCursor = { time: string; id: string };
export type ConnectionsPage = { profile: PublicProfile; items: Connection[]; hasMore: boolean };
export type ConnectionsGateway = {
  load: (cursor: ConnectionCursor | null, signal: AbortSignal) => Promise<ConnectionsPage>;
};
export function parseConnections(
  value: unknown,
  identity: SafetyIdentity,
  profileId: string,
): ConnectionsPage {
  const row = envelope(value, identity);
  const profile = parsePublicProfile(row.profile);
  if (profile.id !== profileId) throw new Error('Profile changed.');
  const page = parsePage(row, (value): Connection => {
    const item = record(value);
    const isSelf = flag(item.is_self),
      isFollowing = flag(item.is_following);
    if (isSelf && isFollowing) throw new Error('Invalid self relationship.');
    return {
      id: identifier(item.id),
      username: text(item.username),
      avatarId: item.avatar_id == null ? null : identifier(item.avatar_id),
      isSelf,
      isFollowing,
      followedAt: timestamp(item.followed_at),
    };
  });
  return { ...page, profile };
}
export function connectionsGateway(
  identity: SafetyIdentity,
  profileId: string,
  kind: ConnectionKind,
): ConnectionsGateway {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async load(cursor, signal) {
      const result = await client
        .rpc('get_profile_connections', {
          profile_id: profileId,
          list_kind: kind,
          page_size: 20,
          before_time: cursor?.time,
          before_id: cursor?.id,
        })
        .abortSignal(signal);
      if (result.error) {
        if (result.error.code === '42501')
          throw new SafetyUnavailable('This list is no longer available.');
        throw new Error('Connections could not be loaded.');
      }
      return parseConnections(result.data, identity, profileId);
    },
  };
}
