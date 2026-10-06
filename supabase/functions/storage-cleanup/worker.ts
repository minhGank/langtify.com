export type Kind = 'submissions' | 'avatars';
export type Counts = { claimed: number; removed: number; retry: number };
export type Result = Record<Kind, Counts>;
export interface Store {
  begin(id: string): Promise<boolean>;
  claim(kind: Kind): Promise<string[]>;
  remove(kind: Kind, path: string): Promise<void>;
  finish(kind: Kind, path: string): Promise<void>;
  complete(id: string, counts: Result, uncertain: boolean): Promise<boolean>;
}
export async function cleanup(store: Store, id: string, now = () => performance.now()) {
  const result: Result = {
    submissions: { claimed: 0, removed: 0, retry: 0 },
    avatars: { claimed: 0, removed: 0, retry: 0 },
  };
  if (!(await store.begin(id))) return { status: 'skipped', ...result };
  const deadline = now() + 70_000;
  let uncertain = false;
  for (const kind of ['submissions', 'avatars'] as const) {
    try {
      if (now() >= deadline) {
        uncertain = true;
        break;
      }
      const paths = await store.claim(kind);
      if (paths.length > 100) throw new Error('Invalid batch');
      result[kind].claimed = paths.length;
      let next = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < paths.length && now() < deadline) {
            const path = paths[next++];
            try {
              await store.remove(kind, path);
              await store.finish(kind, path);
              result[kind].removed++;
            } catch {
              uncertain = true;
            }
          }
        }),
      );
      result[kind].retry = paths.length - result[kind].removed;
    } catch {
      uncertain = true;
    }
  }
  if (!(await store.complete(id, result, uncertain)))
    throw new Error('Cleanup result not recorded');
  return {
    status: uncertain || result.submissions.retry || result.avatars.retry ? 'retry' : 'success',
    ...result,
  };
}
