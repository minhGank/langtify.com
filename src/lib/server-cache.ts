import { authSessionId } from './auth-session-storage';

export type ServerSnapshot<T> = {
  data: T | null;
  loading: boolean;
  error: boolean;
  updatedAt: number;
  invalidation: number;
  retired: boolean;
};
export type ServerEntry<T> = {
  getRevision: () => number;
  getSnapshot: () => ServerSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  retain: () => () => void;
  read: (
    load: (signal: AbortSignal) => Promise<T>,
    options: { staleTime: number; force?: boolean; discardOnError?: (cause: unknown) => boolean },
  ) => Promise<void>;
  set: (data: T, options?: { preserveFreshness?: boolean }) => void;
  clear: () => void;
  invalidate: (options?: { discard?: boolean }) => void;
  cancel: () => void;
};
type RegisteredCache = {
  clear: () => void;
  invalidate: (tags: readonly string[], discard: boolean, scope?: string) => void;
  discard: (
    tags: readonly string[],
    scope?: string,
    except?: Pick<ServerEntry<unknown>, 'clear'>,
  ) => void;
};
const caches = new Set<RegisteredCache>();
let activeScope: string | null = null;
const isolatedKeys = new WeakMap<object, string>();
let isolatedSequence = 0;
export function isolatedCacheKey(owner: object) {
  let key = isolatedKeys.get(owner);
  if (!key) {
    key = `isolated:${++isolatedSequence}`;
    isolatedKeys.set(owner, key);
  }
  return key;
}

// Session IDs partition memory; they do not authorize a request. Every gateway
// still sends the current JWT and checks the authoritative response identity.
export function serverScope(userId: string, token: string) {
  return `${userId}:${authSessionId(token) ?? token}`;
}
export function clearServerData() {
  for (const cache of caches) cache.clear();
}
export function setServerScope(scope: string | null) {
  if (scope !== activeScope) {
    activeScope = scope;
    clearServerData();
  }
}
export function invalidateServerData(
  tags: readonly string[],
  options: { discard?: boolean; scope?: string } = {},
) {
  for (const cache of caches) cache.invalidate(tags, options.discard ?? false, options.scope);
}
// Permission failures retire previously authorized data without starting another
// request. The failing entry completes its own error state; other views clear.
export function discardServerData(
  tags: readonly string[],
  options: { scope?: string; except?: Pick<ServerEntry<unknown>, 'clear'> } = {},
) {
  for (const cache of caches) cache.discard(tags, options.scope, options.except);
}

// A typed, bounded cache per resource family avoids unchecked heterogeneous
// cache casts. Nothing is written to disk, AsyncStorage, or an Auth session.
export function createServerCache<T>({
  maxEntries = 24,
  maxWeight = Infinity,
  weight = () => 1,
}: { maxEntries?: number; maxWeight?: number; weight?: (data: T) => number } = {}) {
  const entries = new Map<
    string,
    { entry: ServerEntry<T>; tags: readonly string[]; retire: () => void; inUse: () => boolean }
  >();
  const registry: RegisteredCache = {
    clear() {
      for (const saved of entries.values()) saved.retire();
      entries.clear();
    },
    invalidate(tags, discard, scope) {
      for (const [key, saved] of entries)
        if ((!scope || key.startsWith(`${scope}:`)) && saved.tags.some((tag) => tags.includes(tag)))
          saved.entry.invalidate({ discard });
    },
    discard(tags, scope, except) {
      for (const [key, saved] of entries)
        if (
          saved.entry !== except &&
          (!scope || key.startsWith(`${scope}:`)) &&
          saved.tags.some((tag) => tags.includes(tag))
        )
          saved.entry.clear();
    },
  };
  caches.add(registry);
  const trim = (keep: string) => {
    const total = () =>
      [...entries.values()].reduce((sum, saved) => {
        const data = saved.entry.getSnapshot().data;
        return sum + (data === null ? 0 : weight(data));
      }, 0);
    while (entries.size > maxEntries || total() > maxWeight) {
      const oldest = [...entries].find(([key, saved]) => key !== keep && !saved.inUse());
      if (!oldest) break;
      oldest[1].retire();
      entries.delete(oldest[0]);
    }
  };
  return {
    clear: registry.clear,
    update(match: (key: string, data: T) => T) {
      for (const [key, saved] of entries) {
        const data = saved.entry.getSnapshot().data;
        if (data !== null) {
          const next = match(key, data);
          if (next !== data) saved.entry.set(next, { preserveFreshness: true });
        }
      }
    },
    entry(key: string, tags: readonly string[]): ServerEntry<T> {
      const saved = entries.get(key);
      if (saved) {
        entries.delete(key);
        entries.set(key, saved);
        return saved.entry;
      }
      let snapshot: ServerSnapshot<T> = {
        data: null,
        loading: false,
        error: false,
        updatedAt: -Infinity,
        invalidation: 0,
        retired: false,
      };
      const listeners = new Set<() => void>();
      let controller: AbortController | null = null;
      let pending: Promise<void> | null = null;
      let generation = 0;
      let retired = false;
      let observers = 0;
      const publish = (next: ServerSnapshot<T>) => {
        snapshot = next;
        listeners.forEach((listener) => listener());
      };
      const cancel = () => {
        generation++;
        controller?.abort();
        controller = null;
        pending = null;
      };
      const entry: ServerEntry<T> = {
        getRevision: () => generation,
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        retain() {
          observers++;
          let released = false;
          return () => {
            if (released) return;
            released = true;
            observers--;
            if (observers === 0) {
              entry.cancel();
              trim(key);
            }
          };
        },
        set(data, { preserveFreshness = false } = {}) {
          if (retired) return;
          cancel();
          publish({
            ...snapshot,
            data,
            loading: false,
            error: false,
            // A partial receipt patch is not a full resource revalidation.
            updatedAt: preserveFreshness ? snapshot.updatedAt : performance.now(),
          });
          trim(key);
        },
        clear() {
          cancel();
          publish({ ...snapshot, data: null, loading: false, error: false, updatedAt: -Infinity });
        },
        invalidate({ discard = false } = {}) {
          cancel();
          publish({
            ...snapshot,
            data: discard ? null : snapshot.data,
            loading: false,
            updatedAt: -Infinity,
            invalidation: snapshot.invalidation + 1,
          });
        },
        cancel() {
          cancel();
          if (snapshot.loading) publish({ ...snapshot, loading: false });
        },
        read(load, { staleTime, force = false, discardOnError }) {
          if (retired) return Promise.resolve();
          if (pending) return pending;
          if (
            !force &&
            snapshot.data !== null &&
            performance.now() - snapshot.updatedAt < staleTime
          )
            return Promise.resolve();
          const request = ++generation;
          controller = new AbortController();
          const signal = controller.signal;
          publish({ ...snapshot, loading: true, error: false });
          // Promise.resolve also turns synchronous gateway failures into handled reads.
          pending = Promise.resolve()
            .then(() => {
              if (signal.aborted || request !== generation || retired)
                throw new Error('Read cancelled.');
              return load(signal);
            })
            .then((data) => {
              if (request === generation) {
                publish({
                  ...snapshot,
                  data,
                  loading: false,
                  error: false,
                  updatedAt: performance.now(),
                });
                trim(key);
              }
            })
            .catch((cause: unknown) => {
              if (request === generation)
                publish({
                  ...snapshot,
                  data: discardOnError?.(cause) ? null : snapshot.data,
                  loading: false,
                  error: true,
                });
            })
            .finally(() => {
              if (request === generation) {
                pending = null;
                controller = null;
              }
            });
          return pending;
        },
      };
      const retire = () => {
        retired = true;
        snapshot = { ...snapshot, retired: true };
        entry.invalidate({ discard: true });
      };
      entries.set(key, { entry, tags, retire, inUse: () => observers > 0 || listeners.size > 0 });
      trim(key);
      return entry;
    },
  };
}
