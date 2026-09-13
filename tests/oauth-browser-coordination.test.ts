import { processLock } from '@supabase/supabase-js';
import { browserCoordination, type AuthLocks } from '@/features/auth/oauth/browser-coordination';
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
const locks: AuthLocks = { request: (name, work) => processLock(name, -1, work) };
it('two browser contexts share a mutation lock and only the latest login/sign-out intent remains current', async () => {
  const saved = storage();
  const a = browserCoordination(saved, locks, 'audit');
  const b = browserCoordination(saved, locks, 'audit');
  let release!: () => void;
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  a.begin('attempt-a');
  const order: string[] = [];
  const installing = a.run(async () => {
    order.push('a-start');
    await held;
    expect(a.current('attempt-a')).toBe(false);
    order.push('a-rollback');
  });
  await Promise.resolve();
  b.begin('sign-out-b');
  const signOut = b.run(async () => {
    order.push('b-sign-out');
  });
  release();
  await Promise.all([installing, signOut]);
  expect(order).toEqual(['a-start', 'a-rollback', 'b-sign-out']);
  a.invalidate('attempt-a');
  expect(b.current('sign-out-b')).toBe(true);
});
it('an early SDK broadcast is processed only after admission or rollback; a killed tab leaves a shared recovery marker', async () => {
  const saved = storage();
  const a = browserCoordination(saved, locks, 'audit');
  const b = browserCoordination(saved, locks, 'audit');
  let accepted = false;
  let observer!: Promise<void>;
  await a.run(async () => {
    a.commit({ sessionId: 'session-a', userId: 'user-a' });
    observer = b.run(async () => {
      expect(b.pending()).toBeNull();
      expect(accepted).toBe(true);
    });
    await Promise.resolve();
    accepted = true;
    a.commit(null);
  });
  await observer;
  a.commit({ sessionId: 'abandoned', userId: 'same-owner' });
  expect(b.pending()).toEqual({ sessionId: 'abandoned', userId: 'same-owner' });
  b.commit(null);
  expect(a.pending()).toBeNull();
});
