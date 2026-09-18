export type NotificationPreferences = {
  enabled: boolean;
  dailyWords: boolean;
  streakReminder: boolean;
  dailyTime: string;
  streakTime: string;
  timezone: string;
};
export const validTime = (value: string) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
export type NotificationIdentity = { userId: string; token: string };
export type Installation = { id: string; secret: string; revision: number };
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';
export type LearningTap = { type: 'DAILY_WORDS' | 'STREAK_AT_RISK'; userId: string };
export function learningTap(value: unknown): LearningTap | null {
  if (!value || typeof value !== 'object' || !('type' in value) || !('userId' in value))
    return null;
  if (
    (value.type !== 'DAILY_WORDS' && value.type !== 'STREAK_AT_RISK') ||
    typeof value.userId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.userId)
  )
    return null;
  return { type: value.type, userId: value.userId };
}

// Serializes durable revision allocation; stale network writes lose to the next
// account's higher revision even if the transport ignores cancellation.
export function installationWriter(deps: {
  load: () => Promise<Installation>;
  save: (value: Installation) => Promise<void>;
  send: (
    value: Installation,
    identity: NotificationIdentity | null,
    token: string | null,
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  let tail = Promise.resolve();
  return (identity: NotificationIdentity | null, token: string | null, signal: AbortSignal) => {
    const work = tail.then(async () => {
      if (signal.aborted) return;
      const previous = await deps.load();
      if (signal.aborted) return;
      const next = { ...previous, revision: previous.revision + 1 };
      if (!Number.isSafeInteger(next.revision))
        throw new Error('Notification registration needs recovery.');
      await deps.save(next);
      if (!signal.aborted) {
        let stop = () => {};
        const cancelled = new Promise<never>((_, reject) => {
          stop = () => reject(new Error('Registration cancelled.'));
        });
        signal.addEventListener('abort', stop, { once: true });
        try {
          await Promise.race([deps.send(next, identity, token, signal), cancelled]);
        } finally {
          signal.removeEventListener('abort', stop);
        }
      }
    });
    tail = work.catch(() => {});
    return work;
  };
}
