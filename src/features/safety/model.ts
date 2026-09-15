export const reportReasons = [
  { value: 'inappropriate', label: 'Unrelated or inappropriate image' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'violence', label: 'Violence' },
  { value: 'harassment_hate', label: 'Harassment or hate' },
  { value: 'spam', label: 'Spam' },
  { value: 'privacy', label: 'Privacy concern' },
  { value: 'other', label: 'Other' },
] as const;
export type ReportReason = (typeof reportReasons)[number]['value'];
export type ReportKind = 'submission' | 'user';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export const moderationActions = [
  { value: 'remove_submission', label: 'Remove photo from public view' },
  { value: 'restore_submission', label: 'Restore photo eligibility' },
  { value: 'suspend_user', label: 'Restrict account public access' },
  { value: 'restore_user', label: 'Restore account public access' },
  { value: 'resolve_report', label: 'Resolve report' },
  { value: 'dismiss_report', label: 'Dismiss report' },
] as const;
export type ModerationAction = (typeof moderationActions)[number]['value'];
export type SafetyIdentity = { userId: string; token: string };
export type SafetyAccess = { moderator: boolean; restricted: boolean };
export type BlockedUser = { id: string; username: string };
export type Report = {
  id: string;
  kind: ReportKind;
  username: string;
  word: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: string;
};
export type ModerationCase = {
  report: Report;
  submissionExists: boolean;
  userExists: boolean;
  removed: boolean;
  restricted: boolean;
};
export type AuditEvent = {
  id: string;
  action: ModerationAction;
  reason: string;
  createdAt: string;
  moderatorId: string;
};
export type SafetyPage<T> = { items: T[]; hasMore: boolean };
export type ReportCursor = { time: string; id: string };
export class SafetyUnavailable extends Error {}
export function isReportReason(value: string): value is ReportReason {
  return reportReasons.some((reason) => reason.value === value);
}
export function isReportStatus(value: unknown): value is ReportStatus {
  return value === 'open' || value === 'resolved' || value === 'dismissed';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid safety response.');
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid safety response.');
  return value;
}
export function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid safety response.');
  return value;
}
export function identifier(value: unknown): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
    throw new Error('Invalid safety identity.');
  return id;
}
export function envelope(value: unknown, identity: SafetyIdentity) {
  const row = record(value);
  if (row.viewer_id !== identity.userId) throw new Error('Safety account changed.');
  return row;
}
export function parseReport(value: unknown): Report {
  const r = record(value),
    reason = text(r.reason),
    kind = r.target_kind;
  if (
    !isReportReason(reason) ||
    !isReportStatus(r.status) ||
    (kind !== 'user' && kind !== 'submission')
  )
    throw new Error('Invalid report.');
  return {
    id: identifier(r.id),
    kind,
    username: text(r.username_snapshot),
    word: text(r.word_snapshot),
    reason,
    details: text(r.details),
    status: r.status,
    createdAt: timestamp(r.created_at),
  };
}
export function timestamp(value: unknown) {
  const time = text(value);
  if (!Number.isFinite(Date.parse(time))) throw new Error('Invalid timestamp.');
  return time;
}
export function parsePage<T extends { id: string }>(
  row: Record<string, unknown>,
  parse: (value: unknown) => T,
): SafetyPage<T> {
  if (!Array.isArray(row.items) || row.items.length > 20) throw new Error('Invalid page.');
  const items = row.items.map(parse),
    hasMore = flag(row.has_more);
  if (new Set(items.map((r) => r.id)).size !== items.length || (hasMore && !items.length))
    throw new Error('Invalid page.');
  return { items, hasMore };
}
export function parseAudit(value: unknown): AuditEvent {
  const r = record(value),
    action = moderationActions.find((a) => a.value === r.action)?.value;
  const id = text(r.id);
  if (!action || !/^[1-9][0-9]*$/.test(id)) throw new Error('Invalid audit event.');
  return {
    id,
    action,
    reason: text(r.reason),
    createdAt: timestamp(r.created_at),
    moderatorId: identifier(r.moderator_user_id),
  };
}
