import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import type { Attempt, NotificationStore, ReceiptTarget } from './worker.ts';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid notification data');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid notification data');
  return value;
}
function attempt(value: unknown): Attempt {
  const a = record(value);
  if (
    (a.type !== 'DAILY_WORDS' && a.type !== 'STREAK_AT_RISK') ||
    typeof a.expiresAt !== 'number' ||
    !Number.isSafeInteger(a.expiresAt)
  )
    throw new Error('Invalid notification data');
  return {
    id: text(a.id),
    token: text(a.token),
    title: text(a.title),
    body: text(a.body),
    type: a.type,
    userId: text(a.userId),
    expiresAt: a.expiresAt,
  };
}
export function notificationStore(client: SupabaseClient<Database>): NotificationStore {
  return {
    async claim() {
      const r = await client
        .rpc('claim_notification_attempts', { batch_size: 10 })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error) throw new Error('Notification claim failed');
      const row = record(r.data);
      if (
        !Array.isArray(row.attempts) ||
        row.attempts.length > 100 ||
        typeof row.failed !== 'number'
      )
        throw new Error('Invalid notification batch');
      return { attempts: row.attempts.map(attempt), failed: row.failed };
    },
    async authorize(id) {
      const r = await client
        .rpc('authorize_notification_attempt', { notification_id: id })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error || typeof r.data !== 'boolean')
        throw new Error('Notification authorization failed');
      return r.data;
    },
    async result(id, ticket) {
      const r = await client
        .rpc('record_notification_result', {
          notification_id: id,
          result_status: ticket.state,
          provider_ticket: ticket.ticketId,
          provider_error: ticket.error,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error) throw new Error('Notification result recording failed');
    },
    async receipts(): Promise<ReceiptTarget[]> {
      const r = await client
        .rpc('claim_notification_receipts', { batch_size: 100 })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error || !Array.isArray(r.data) || r.data.length > 100)
        throw new Error('Notification receipt claim failed');
      return r.data.map((value) => {
        const row = record(value);
        return { id: text(row.id), ticketId: text(row.ticketId) };
      });
    },
    async receipt(target, value) {
      const r = await client
        .rpc('record_notification_receipt', {
          notification_id: target.id,
          provider_ticket: target.ticketId,
          receipt_status: value.status,
          provider_error: value.error,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error) throw new Error('Notification receipt recording failed');
    },
  };
}
