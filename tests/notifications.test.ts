import {
  installationWriter,
  learningTap,
  validTime,
  type Installation,
} from '@/features/notifications/model';
const userId = '10000000-0000-4000-8000-000000000001';
it('accepts only fixed learning types and valid recipients, never arbitrary routes', () => {
  expect(learningTap({ type: 'DAILY_WORDS', userId, url: 'https://evil.test' })).toEqual({
    type: 'DAILY_WORDS',
    userId,
  });
  for (const value of [
    null,
    { route: '/moderation' },
    { type: 'OTHER', userId },
    { type: 'DAILY_WORDS', userId: 'invalid' },
  ])
    expect(learningTap(value)).toBeNull();
  expect(learningTap({ type: 'STREAK_AT_RISK', userId })).toBeTruthy();
});
it('validates minute precision and day boundaries', () => {
  for (const time of ['00:00', '08:00', '19:00', '23:59']) expect(validTime(time)).toBe(true);
  for (const time of ['24:00', '8:00', '08:60', '08:00:01', 'UTC'])
    expect(validTime(time)).toBe(false);
});
it('persists ordered revisions and lets revocation pass an aborted uncooperative write', async () => {
  let stored: Installation = { id: userId, secret: 'a'.repeat(64), revision: 0 };
  const send = jest
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue(undefined);
  const write = installationWriter({
    load: async () => stored,
    save: async (v) => {
      stored = v;
    },
    send,
  });
  const old = new AbortController();
  const first = write({ userId, token: 'jwt' }, 'push', old.signal);
  const rejected = expect(first).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  old.abort();
  await rejected;
  await write(null, null, new AbortController().signal);
  expect(send.mock.calls[0][0].revision).toBe(1);
  expect(send.mock.calls[1][0].revision).toBe(2);
  expect(send.mock.calls[1][1]).toBeNull();
});
it('never submits a binding after cancellation during secure-storage allocation', async () => {
  const controller = new AbortController(),
    send = jest.fn();
  const write = installationWriter({
    load: async () => ({ id: userId, secret: 'a'.repeat(64), revision: 2 }),
    save: async () => {
      controller.abort();
    },
    send,
  });
  await write({ userId, token: 'old' }, 'push', controller.signal);
  expect(send).not.toHaveBeenCalled();
});
