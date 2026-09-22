import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/env';
import { boundedFetch } from '@/lib/http';
import type { Database } from '@/types/database';
import { normalizeUsername } from '@/features/onboarding/validation';
import {
  envelope,
  flag,
  identifier,
  parsePage,
  record,
  text,
  timestamp,
  SafetyUnavailable,
  type ReportReason,
  type SafetyIdentity,
} from '@/features/safety/model';

export type PublicProfile = {
  id: string;
  username: string;
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  avatarId: string | null;
};
export type FollowReceipt = {
  profile: PublicProfile | null;
  viewerProfile: PublicProfile | null;
  followedAt: string | null;
};
export type UserResult = Pick<
  PublicProfile,
  'id' | 'username' | 'avatarId' | 'isSelf' | 'isFollowing'
>;
export type Comment = {
  id: string;
  body: string;
  username: string;
  profileId: string;
  createdAt: string;
  isOwn: boolean;
};
export type CommentCursor = { time: string; id: string };
export type UserCursor = { username: string; id: string };
export type PublicProfileTarget = { profileId: string } | { submissionId: string } | undefined;
function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid public count.');
  return value;
}
export function parsePublicProfile(value: unknown): PublicProfile {
  const row = record(value);
  return {
    id: identifier(row.id),
    username: text(row.username),
    isSelf: flag(row.is_self),
    isFollowing: flag(row.is_following),
    followerCount: count(row.follower_count),
    followingCount: count(row.following_count),
    avatarId: row.avatar_id == null ? null : identifier(row.avatar_id),
  };
}
export function parseComment(value: unknown): Comment {
  const row = record(value);
  const body = text(row.body);
  if (!body.trim() || [...body].length > 500) throw new Error('Invalid comment.');
  return {
    id: identifier(row.id),
    body,
    username: text(row.username),
    profileId: identifier(row.profile_id),
    createdAt: timestamp(row.created_at),
    isOwn: flag(row.is_own),
  };
}
export function socialGateway(identity: SafetyIdentity) {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  async function receive(request: PromiseLike<{ data: unknown; error: unknown }>) {
    const result = await request;
    if (result.error) {
      const code = record(result.error).code;
      if (code === '42501') throw new SafetyUnavailable('This content is no longer available.');
      if (code === '23505') throw new Error('That username is already taken.');
      throw new Error('The change could not be confirmed. Refresh before trying again.');
    }
    return envelope(result.data, identity);
  }
  async function acknowledge(request: PromiseLike<{ data: unknown; error: unknown }>) {
    if (!flag((await receive(request)).ok)) throw new Error('Unconfirmed change.');
  }
  return {
    async profile(target: PublicProfileTarget, signal: AbortSignal) {
      const row = await receive(
        client
          .rpc('get_public_profile', {
            profile_id: target && 'profileId' in target ? target.profileId : undefined,
            submission_id: target && 'submissionId' in target ? target.submissionId : undefined,
          })
          .abortSignal(signal),
      );
      return parsePublicProfile(row.profile);
    },
    async search(prefix: string, cursor: UserCursor | null, signal: AbortSignal) {
      const row = await receive(
        client
          .rpc('search_public_profiles', {
            prefix: normalizeUsername(prefix),
            after_username: cursor?.username,
            after_id: cursor?.id,
          })
          .abortSignal(signal),
      );
      return parsePage<UserResult>(row, (value) => {
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
        };
      });
    },
    updateUsername(username: string, signal: AbortSignal) {
      return acknowledge(
        client
          .rpc('update_my_profile', { username: normalizeUsername(username) })
          .abortSignal(signal),
      );
    },
    updateLearning(
      input: {
        referenceLanguageId: string;
        targetLanguageId: string;
        cefrLevel: string;
        timezone: string;
      },
      signal: AbortSignal,
    ) {
      return acknowledge(
        client
          .rpc('update_learning_preferences', {
            reference_language_id: input.referenceLanguageId,
            target_language_id: input.targetLanguageId,
            cefr_level: input.cefrLevel,
            timezone: input.timezone,
          })
          .abortSignal(signal),
      );
    },
    async follow(id: string, following: boolean, signal: AbortSignal): Promise<FollowReceipt> {
      const row = await receive(
        client.rpc('set_follow', { profile_id: id, following }).abortSignal(signal),
      );
      if (!flag(row.ok)) throw new Error('Unconfirmed change.');
      const profile = row.profile === null ? null : parsePublicProfile(row.profile);
      const viewerProfile =
        row.viewer_profile === null ? null : parsePublicProfile(row.viewer_profile);
      const followedAt = row.followed_at === null ? null : timestamp(row.followed_at);
      if (
        (profile && (profile.id !== id || profile.isSelf || profile.isFollowing !== following)) ||
        (viewerProfile && !viewerProfile.isSelf) ||
        following !== (followedAt !== null)
      )
        throw new Error('Invalid follow confirmation.');
      return { profile, viewerProfile, followedAt };
    },
    block(id: string, signal: AbortSignal) {
      return acknowledge(
        client.rpc('block_public_profile', { profile_id: id }).abortSignal(signal),
      );
    },
    async comments(id: string, cursor: CommentCursor | null, signal: AbortSignal) {
      return parsePage(
        await receive(
          client
            .rpc('get_submission_comments', {
              submission_id: id,
              before_time: cursor?.time,
              before_id: cursor?.id,
            })
            .abortSignal(signal),
        ),
        parseComment,
      );
    },
    createComment(id: string, body: string, requestId: string, signal: AbortSignal) {
      return acknowledge(
        client
          .rpc('create_submission_comment', { submission_id: id, body, request_id: requestId })
          .abortSignal(signal),
      );
    },
    deleteComment(id: string, signal: AbortSignal) {
      return acknowledge(
        client.rpc('delete_submission_comment', { comment_id: id }).abortSignal(signal),
      );
    },
    reportComment(id: string, reason: ReportReason, details: string, signal: AbortSignal) {
      return acknowledge(
        client
          .rpc('report_submission_comment', { comment_id: id, reason, details })
          .abortSignal(signal),
      );
    },
  };
}
export type SocialGateway = ReturnType<typeof socialGateway>;
