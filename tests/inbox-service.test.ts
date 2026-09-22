import { createClient } from '@supabase/supabase-js';
import { inboxGateway } from '@/services/inbox';
import { SafetyUnavailable } from '@/features/safety/model';

const mockRpc = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ rpc: mockRpc })) }));
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://fixture.supabase.co', key: 'public-fixture-key' } },
}));
const identity = { userId: '88000000-0000-4000-8000-000000000001', token: 'viewer-session-token' };
const id = '88000000-0000-4000-8000-000000000002';
const cursor = { time: '2026-09-22T14:30:00.123456+00:00', id };
function respond(data: unknown, error: unknown = null) {
  const abortSignal = jest.fn().mockResolvedValue({ data, error });
  mockRpc.mockReturnValue({ abortSignal });
  return abortSignal;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockReset();
});

it('uses only public configuration and the current account token for isolated requests', async () => {
  respond({ viewer_id: identity.userId, unread_count: 0, read_cursor: null });
  await inboxGateway(identity).summary(new AbortController().signal);
  expect(createClient).toHaveBeenCalledWith('https://fixture.supabase.co', 'public-fixture-key', {
    global: { fetch: expect.any(Function) },
    accessToken: expect.any(Function),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});
it('uses actual bounded RPC arguments and preserves cursor precision', async () => {
  const signal = new AbortController().signal;
  const abort = respond({
    viewer_id: identity.userId,
    items: [],
    has_more: false,
    unread_count: 0,
    read_cursor: cursor,
  });
  expect(await inboxGateway(identity).page(cursor, signal)).toEqual({
    items: [],
    hasMore: false,
    unreadCount: 0,
    readCursor: cursor,
  });
  expect(mockRpc).toHaveBeenCalledWith('get_notification_inbox', {
    before_time: cursor.time,
    before_id: id,
    page_size: 20,
  });
  expect(abort).toHaveBeenCalledWith(signal);
});
it('sends only notification IDs and read intent, never client-generated events or recipients', async () => {
  const signal = new AbortController().signal;
  respond({ viewer_id: identity.userId, ok: true, unread_count: 4 });
  const gateway = inboxGateway(identity);
  expect(await gateway.read(id, false, signal)).toEqual({ unreadCount: 4 });
  expect(mockRpc).toHaveBeenLastCalledWith('set_notification_read', {
    notification_id: id,
    read: false,
  });
  await gateway.readAll(cursor, signal);
  expect(mockRpc).toHaveBeenLastCalledWith('mark_notifications_read', {
    through_time: cursor.time,
    through_id: id,
  });
});
it('rejects another account’s response for reads, read writes and target resolution', async () => {
  respond({
    viewer_id: id,
    ok: true,
    unread_count: 0,
    read_cursor: null,
    kind: 'DAILY_WORDS_READY',
    challenge_id: id,
  });
  const gateway = inboxGateway(identity);
  const signal = new AbortController().signal;
  await expect(gateway.summary(signal)).rejects.toThrow('account changed');
  await expect(gateway.read(id, true, signal)).rejects.toThrow('account changed');
  await expect(gateway.resolve(id, signal)).rejects.toThrow('account changed');
});
it('turns authority denial into fail-closed safety errors without exposing server details', async () => {
  respond(null, { code: '42501', message: 'Internal target is private: secret details' });
  const gateway = inboxGateway(identity);
  const signal = new AbortController().signal;
  await expect(gateway.resolve(id, signal)).rejects.toThrow(SafetyUnavailable);
  await expect(gateway.page(null, signal)).rejects.toThrow(
    'This notification is no longer available.',
  );
});
it('does not accept unconfirmed mutation receipts or negative aggregate counters', async () => {
  const gateway = inboxGateway(identity);
  const signal = new AbortController().signal;
  respond({ viewer_id: identity.userId, ok: false, unread_count: 0 });
  await expect(gateway.read(id, true, signal)).rejects.toThrow('could not be confirmed');
  respond({ viewer_id: identity.userId, ok: true, unread_count: -1 });
  await expect(gateway.read(id, true, signal)).rejects.toThrow('Invalid unread count');
});
it('resolves only a server-authorized notification ID and drops unrelated routing fields', async () => {
  respond({
    viewer_id: identity.userId,
    kind: 'NEW_RATING',
    assignment_id: id,
    route: '/moderation',
    signed_url: 'https://private.invalid',
    rater_id: 'hidden',
  });
  const result = await inboxGateway(identity).resolve(id, new AbortController().signal);
  expect(mockRpc).toHaveBeenCalledWith('resolve_notification_target', { notification_id: id });
  expect(result).toEqual({ kind: 'NEW_RATING', assignmentId: id });
});
