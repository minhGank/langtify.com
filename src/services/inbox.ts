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
  SafetyUnavailable,
  text,
  timestamp,
  type SafetyIdentity,
} from '@/features/safety/model';

export type InboxCursor = { time: string; id: string };
type NotificationBase = { id: string; createdAt: string; read: boolean };
export type InboxNotification = NotificationBase &
  (
    | { kind: 'NEW_FOLLOWER'; profileId: string; username: string }
    | { kind: 'NEW_RATING'; assignmentId: string; targetTerm: string }
    | { kind: 'DAILY_WORDS_READY'; challengeId: string }
  );
export type InboxSummary = { unreadCount: number; readCursor: InboxCursor | null };
export type InboxPage = InboxSummary & { items: InboxNotification[]; hasMore: boolean };
export type InboxReceipt = { unreadCount: number };
export type InboxTarget =
  | { kind: 'NEW_FOLLOWER'; profileId: string }
  | { kind: 'NEW_RATING'; assignmentId: string }
  | { kind: 'DAILY_WORDS_READY'; challengeId: string };

function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid unread count.');
  return value;
}
export function parseInboxSummary(value: unknown): InboxSummary {
  const row = record(value);
  const cursor = row.read_cursor == null ? null : record(row.read_cursor);
  return {
    unreadCount: count(row.unread_count),
    readCursor: cursor ? { time: timestamp(cursor.time), id: identifier(cursor.id) } : null,
  };
}
export function parseInboxNotification(value: unknown): InboxNotification {
  const row = record(value);
  const base = {
    id: identifier(row.id),
    createdAt: timestamp(row.created_at),
    read: row.read_at != null,
  };
  if (row.read_at != null) timestamp(row.read_at);
  if (row.kind === 'NEW_FOLLOWER') {
    const username = text(row.username);
    if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(username)) throw new Error('Invalid username.');
    return { ...base, kind: row.kind, profileId: identifier(row.profile_id), username };
  }
  if (row.kind === 'NEW_RATING') {
    const targetTerm = text(row.target_term);
    if (!targetTerm.trim() || targetTerm.length > 500) throw new Error('Invalid vocabulary term.');
    return { ...base, kind: row.kind, assignmentId: identifier(row.assignment_id), targetTerm };
  }
  if (row.kind === 'DAILY_WORDS_READY')
    return { ...base, kind: row.kind, challengeId: identifier(row.challenge_id) };
  throw new Error('Invalid notification kind.');
}
export function parseInboxPage(value: unknown): InboxPage {
  const row = record(value);
  return { ...parseInboxSummary(row), ...parsePage(row, parseInboxNotification) };
}
export function parseInboxTarget(value: unknown): InboxTarget {
  const row = record(value);
  if (row.kind === 'NEW_FOLLOWER') return { kind: row.kind, profileId: identifier(row.profile_id) };
  if (row.kind === 'NEW_RATING')
    return { kind: row.kind, assignmentId: identifier(row.assignment_id) };
  if (row.kind === 'DAILY_WORDS_READY')
    return { kind: row.kind, challengeId: identifier(row.challenge_id) };
  throw new Error('Invalid notification target.');
}
export function inboxGateway(identity: SafetyIdentity) {
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
      if (record(result.error).code === '42501')
        throw new SafetyUnavailable('This notification is no longer available.');
      throw new Error('Notifications could not be loaded. Please refresh and try again.');
    }
    return envelope(result.data, identity);
  }
  async function receipt(
    request: PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<InboxReceipt> {
    const row = await receive(request);
    if (!flag(row.ok)) throw new Error('The change could not be confirmed.');
    return { unreadCount: count(row.unread_count) };
  }
  return {
    async summary(signal: AbortSignal) {
      return parseInboxSummary(
        await receive(client.rpc('get_notification_summary').abortSignal(signal)),
      );
    },
    async page(cursor: InboxCursor | null, signal: AbortSignal) {
      return parseInboxPage(
        await receive(
          client
            .rpc('get_notification_inbox', {
              before_time: cursor?.time,
              before_id: cursor?.id,
              page_size: 20,
            })
            .abortSignal(signal),
        ),
      );
    },
    read(id: string, read: boolean, signal: AbortSignal) {
      return receipt(
        client.rpc('set_notification_read', { notification_id: id, read }).abortSignal(signal),
      );
    },
    readAll(cursor: InboxCursor, signal: AbortSignal) {
      return receipt(
        client
          .rpc('mark_notifications_read', {
            through_time: cursor.time,
            through_id: cursor.id,
          })
          .abortSignal(signal),
      );
    },
    async resolve(id: string, signal: AbortSignal) {
      return parseInboxTarget(
        await receive(
          client
            .rpc('resolve_notification_target', {
              notification_id: id,
            })
            .abortSignal(signal),
        ),
      );
    },
  };
}
export type InboxGateway = ReturnType<typeof inboxGateway>;
