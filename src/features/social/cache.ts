import {
  createServerCache,
  discardServerData,
  invalidateServerData,
  serverScope,
  type ServerEntry,
} from '@/lib/server-cache';
import type {
  Comment,
  FollowReceipt,
  PublicProfile,
  UserResult,
  UserCursor,
} from '@/services/social';
import type {
  Connection,
  ConnectionCursor,
  ConnectionKind,
  ConnectionsPage,
} from '@/services/connections';
import type { SafetyIdentity, SafetyPage } from '@/features/safety/model';

export type ConnectionsWindow = ConnectionsPage & {
  kind: ConnectionKind;
  cursor: ConnectionCursor | null;
  fromLatest: boolean;
};
export const connectionsCache = createServerCache<ConnectionsWindow>({ maxEntries: 12 });
export const profileCache = createServerCache<PublicProfile>({ maxEntries: 16 });
export type SearchWindow = SafetyPage<UserResult> & {
  cursor?: UserCursor | null;
  fromStart?: boolean;
};
export const searchCache = createServerCache<SearchWindow>({ maxEntries: 8 });
export const commentCache = createServerCache<SafetyPage<Comment>>({ maxEntries: 12 });
const publicTags = [
  'discover',
  'public-profile',
  'user-search',
  'follows',
  'comments',
  'safety',
  'avatars',
  'connections',
  'inbox',
];
export function discardPublicData(
  identity: SafetyIdentity,
  except?: Pick<ServerEntry<unknown>, 'clear'>,
) {
  discardServerData(publicTags, { scope: serverScope(identity.userId, identity.token), except });
}
export function socialChanged(
  kind: 'profile' | 'follow' | 'block' | 'comment',
  submissionId?: string,
) {
  if (kind === 'block') {
    invalidateServerData(publicTags, { discard: true });
  } else if (kind === 'profile') {
    invalidateServerData([
      'public-profile',
      'user-search',
      'comments',
      'discover',
      'avatars',
      'connections',
      'inbox',
    ]);
  } else if (kind === 'follow') {
    invalidateServerData(['public-profile', 'follows', 'connections']);
  } else {
    invalidateServerData([`comments:${submissionId}`], { discard: true });
  }
}

// Only server receipts change follow state/counts. Keep loaded pages and scroll
// positions while patching precisely the two relationships affected by this write.
export function followChanged(identity: SafetyIdentity, receipt: FollowReceipt) {
  const scope = serverScope(identity.userId, identity.token);
  const { profile, viewerProfile, followedAt } = receipt;
  if (!profile || !viewerProfile) {
    discardPublicData(identity);
    return;
  }
  const profiles = [profile, viewerProfile];
  searchCache.update((key, value) =>
    key.startsWith(`${scope}:`) &&
    value.items.some((item) => profiles.some((profile) => profile.id === item.id))
      ? {
          ...value,
          items: value.items.map(
            (item) => profiles.find((profile) => profile.id === item.id) ?? item,
          ),
        }
      : value,
  );
  profileCache.update((key, value) =>
    key.startsWith(`${scope}:`) ? (profiles.find((item) => item.id === value.id) ?? value) : value,
  );
  connectionsCache.update((key, value) => {
    if (!key.startsWith(`${scope}:`)) return value;
    const owner = profiles.find((item) => item.id === value.profile.id) ?? value.profile;
    let items = value.items.map((item) =>
      item.id === profile.id
        ? {
            ...item,
            username: profile.username,
            avatarId: profile.avatarId,
            isFollowing: profile.isFollowing,
          }
        : item,
    );
    const member =
      value.kind === 'following' && owner.id === viewerProfile.id
        ? profile
        : value.kind === 'followers' && owner.id === profile.id
          ? viewerProfile
          : null;
    if (owner === value.profile && !member && !value.items.some((item) => item.id === profile.id))
      return value;
    if (member) {
      if (!followedAt || value.fromLatest) items = items.filter((item) => item.id !== member.id);
      if (followedAt && value.fromLatest) {
        const row: Connection = {
          id: member.id,
          username: member.username,
          avatarId: member.avatarId,
          isSelf: member.isSelf,
          isFollowing: member.isFollowing,
          followedAt,
        };
        items = [...items, row].sort(
          (a, b) => compareConnectionTime(b.followedAt, a.followedAt) || b.id.localeCompare(a.id),
        );
      }
    }
    const bounded = items.slice(0, 40);
    const last = bounded.at(-1);
    return {
      ...value,
      profile: owner,
      items: bounded,
      hasMore: value.hasMore || items.length > 40,
      cursor: items.length > 40 && last ? { time: last.followedAt, id: last.id } : value.cursor,
    };
  });
}

// Date.parse keeps milliseconds; retain PostgreSQL's additional microseconds
// when a follow receipt lands inside the same millisecond as an existing row.
function compareConnectionTime(a: string, b: string) {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds) return milliseconds;
  const fraction = (value: string) =>
    (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6);
  return fraction(a).localeCompare(fraction(b));
}
