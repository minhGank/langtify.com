import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { publicConfig } from '@/lib/env';
import {
  envelope,
  flag,
  identifier,
  parseAudit,
  parsePage,
  parseReport,
  record,
  text,
  SafetyUnavailable,
  type ModerationAction,
  type ReportCursor,
  type ReportKind,
  type ReportReason,
  type ReportStatus,
  type SafetyIdentity,
} from '@/features/safety/model';

export function safetyGateway(identity: SafetyIdentity) {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  function activeClient(signal: AbortSignal) {
    if (signal.aborted) throw new Error('Request cancelled.');
    return client;
  }
  async function receive(request: PromiseLike<{ data: unknown; error: unknown }>) {
    const result = await request;
    if (result.error) {
      if (record(result.error).code === '42501')
        throw new SafetyUnavailable('This action or account is no longer available.');
      throw new Error(
        'Request could not be confirmed. Refresh to check current state before retrying.',
      );
    }
    return envelope(result.data, identity);
  }
  async function acknowledge(request: PromiseLike<{ data: unknown; error: unknown }>) {
    if (!flag((await receive(request)).ok)) throw new Error('Unconfirmed action.');
  }
  return {
    async access(signal: AbortSignal) {
      const r = await receive(activeClient(signal).rpc('get_safety_access').abortSignal(signal));
      return { moderator: flag(r.moderator), restricted: flag(r.restricted) };
    },
    async blocks(beforeId: string | null, signal: AbortSignal) {
      return parsePage(
        await receive(
          activeClient(signal)
            .rpc('get_blocked_users', { before_id: beforeId ?? undefined })
            .abortSignal(signal),
        ),
        (v) => {
          const r = record(v);
          return { id: identifier(r.id), username: text(r.username) };
        },
      );
    },
    block(id: string, signal: AbortSignal) {
      return acknowledge(
        activeClient(signal)
          .rpc('block_submission_user', { submission_id: id })
          .abortSignal(signal),
      );
    },
    unblock(id: string, signal: AbortSignal) {
      return acknowledge(
        activeClient(signal).rpc('unblock_user', { block_id: id }).abortSignal(signal),
      );
    },
    report(
      id: string,
      kind: ReportKind,
      reason: ReportReason,
      details: string,
      signal: AbortSignal,
    ) {
      return acknowledge(
        activeClient(signal)
          .rpc('report_public_content', { submission_id: id, target_kind: kind, reason, details })
          .abortSignal(signal),
      );
    },
    async queue(status: ReportStatus, cursor: ReportCursor | null, signal: AbortSignal) {
      return parsePage(
        await receive(
          activeClient(signal)
            .rpc('get_moderation_queue', {
              report_status: status,
              after_time: cursor?.time,
              after_id: cursor?.id,
            })
            .abortSignal(signal),
        ),
        parseReport,
      );
    },
    async detail(id: string, signal: AbortSignal) {
      const r = await receive(
        activeClient(signal).rpc('get_moderation_report', { report_id: id }).abortSignal(signal),
      );
      const report = parseReport(r.report);
      if (report.id !== id) throw new Error('Report changed.');
      return {
        report,
        submissionExists: flag(r.submission_exists),
        userExists: flag(r.user_exists),
        removed: flag(r.removed),
        restricted: flag(r.restricted),
      };
    },
    async history(id: string, beforeId: string | null, signal: AbortSignal) {
      // Generated bigint parameters use JS numbers. Reject unsafe cursors rather
      // than silently rounding an audit position.
      const cursor = beforeId === null ? undefined : Number(beforeId);
      if (cursor !== undefined && !Number.isSafeInteger(cursor))
        throw new Error('Audit cursor exceeds client precision.');
      return parsePage(
        await receive(
          activeClient(signal)
            .rpc('get_moderation_history', { report_id: id, before_id: cursor })
            .abortSignal(signal),
        ),
        parseAudit,
      );
    },
    moderate(
      id: string,
      action: ModerationAction,
      requestId: string,
      reason: string,
      signal: AbortSignal,
    ) {
      return acknowledge(
        activeClient(signal)
          .rpc('moderate_report', { report_id: id, action, request_id: requestId, reason })
          .abortSignal(signal),
      );
    },
    async photo(id: string, signal: AbortSignal) {
      const { data, error } = await activeClient(signal).functions.invoke('photo-authority', {
        body: { action: 'moderation-preview', reportId: id },
        signal,
      });
      if (error) throw new SafetyUnavailable('Moderator photo access is unavailable.');
      const r = envelope(data, identity);
      if (r.report_id !== id) throw new Error('Report changed.');
      if (r.photo === null) return null;
      const photo = record(r.photo),
        path = text(photo.signed_path),
        photoId = identifier(photo.id);
      const match =
        /^\/storage\/v1\/object\/sign\/challenge-submissions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/([0-9a-f-]{36})\.jpg\?token=[A-Za-z0-9_.-]+$/.exec(
          path,
        );
      if (!match || match[1] !== photoId) throw new Error('Invalid moderator photo.');
      return config.url + path;
    },
  };
}
export type SafetyGateway = ReturnType<typeof safetyGateway>;
