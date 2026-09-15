import { safetyGateway } from '@/services/safety';
import { envelope, parsePage, parseReport, record } from '@/features/safety/model';
const mockRpc = jest.fn(),
  mockInvoke = jest.fn(),
  mockAbort = jest.fn(),
  mockCreate = jest.fn();
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://api.test', key: 'test-public-key' } },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mockCreate(...args);
    return { rpc: mockRpc, functions: { invoke: mockInvoke } };
  },
}));
const identity = { userId: 'viewer', token: 'captured-token' };
const id = '79000000-0000-4000-8000-000000000001';
function response(data: unknown) {
  mockRpc.mockReturnValue(
    Object.assign(Promise.resolve({ data, error: null }), {
      abortSignal: (signal: AbortSignal) => {
        mockAbort(signal);
        return Promise.resolve({ data, error: null });
      },
    }),
  );
}
beforeEach(() => jest.clearAllMocks());
it('pins Auth and submits only controlled report/block/moderation inputs', async () => {
  response({ viewer_id: 'viewer', ok: true });
  const gateway = safetyGateway(identity),
    signal = new AbortController().signal;
  await gateway.report(id, 'user', 'privacy', 'Context', signal);
  expect(mockRpc).toHaveBeenLastCalledWith('report_public_content', {
    submission_id: id,
    target_kind: 'user',
    reason: 'privacy',
    details: 'Context',
  });
  await gateway.block(id, signal);
  expect(mockRpc).toHaveBeenLastCalledWith('block_submission_user', { submission_id: id });
  await gateway.moderate(id, 'resolve_report', id, 'Reviewed', signal);
  expect(mockRpc).toHaveBeenLastCalledWith('moderate_report', {
    report_id: id,
    action: 'resolve_report',
    request_id: id,
    reason: 'Reviewed',
  });
  expect(await mockCreate.mock.calls[0][2].accessToken()).toBe('captured-token');
  expect(mockCreate.mock.calls[0][2].auth.persistSession).toBe(false);
  expect(mockAbort).toHaveBeenCalledWith(signal);
});
it('rejects stale viewer envelopes and malformed or oversized pages', () => {
  expect(() => envelope({ viewer_id: 'other' }, identity)).toThrow();
  const report = {
    id,
    target_kind: 'submission',
    username_snapshot: 'learner',
    word_snapshot: 'chien',
    reason: 'privacy',
    details: '',
    status: 'open',
    created_at: '2026-09-14T12:00:00Z',
  };
  expect(parseReport(report).kind).toBe('submission');
  for (const changes of [
    { reason: 'invented' },
    { status: 'unknown' },
    { target_kind: 'other' },
    { created_at: 'invalid' },
  ])
    expect(() => parseReport({ ...report, ...changes })).toThrow();
  for (const page of [
    { items: [report, report], has_more: false },
    { items: Array(21).fill(report), has_more: false },
    { items: [], has_more: true },
  ])
    expect(() => parsePage(record(page), parseReport)).toThrow();
});
it('accepts only the expected report and fixed bucket capability from moderator signing', async () => {
  const gateway = safetyGateway(identity),
    signal = new AbortController().signal;
  const path = `/storage/v1/object/sign/challenge-submissions/${id}/${id}.jpg?token=a.b.c`;
  mockInvoke.mockResolvedValue({
    data: { viewer_id: 'viewer', report_id: id, photo: { id, signed_path: path } },
    error: null,
  });
  expect(await gateway.photo(id, signal)).toBe('https://api.test' + path);
  expect(mockInvoke).toHaveBeenCalledWith('photo-authority', {
    body: { action: 'moderation-preview', reportId: id },
    signal,
  });
  for (const changes of [
    { viewer_id: 'other' },
    { report_id: 'other' },
    { photo: { id, signed_path: 'https://evil.test/photo' } },
    { photo: { id, signed_path: path + '&download=1' } },
  ]) {
    mockInvoke.mockResolvedValue({
      data: { viewer_id: 'viewer', report_id: id, photo: { id, signed_path: path }, ...changes },
      error: null,
    });
    await expect(gateway.photo(id, signal)).rejects.toThrow();
  }
});
it('does not start an already-cancelled follow-up request', async () => {
  const gateway = safetyGateway(identity),
    controller = new AbortController();
  controller.abort();
  const signal = controller.signal;
  const operations: (() => Promise<unknown>)[] = [
    () => gateway.access(signal),
    () => gateway.blocks(null, signal),
    () => gateway.block(id, signal),
    () => gateway.unblock(id, signal),
    () => gateway.report(id, 'submission', 'other', '', signal),
    () => gateway.queue('open', null, signal),
    () => gateway.detail(id, signal),
    () => gateway.history(id, null, signal),
    () => gateway.moderate(id, 'resolve_report', id, '', signal),
    () => gateway.photo(id, signal),
  ];
  for (const operation of operations)
    await expect(Promise.resolve().then(operation)).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockInvoke).not.toHaveBeenCalled();
});
