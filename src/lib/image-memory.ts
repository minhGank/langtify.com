import { createServerCache } from './server-cache';
import { jpegDataUri } from '@/features/photos/jpeg';

// Downloaded pixels are not bearer capabilities. Keep only bounded, session-scoped
// JPEG data in memory; never persist a signed URL or reuse one after its deadline.
const images = createServerCache<string>({
  maxEntries: 48,
  maxWeight: 32 * 1024 * 1024,
  weight: (uri) => uri.length * 2,
});
const maximumImageBytes = 5 * 1024 * 1024;
const downloadWaiters: (() => void)[] = [];
let downloading = 0;

function cancelled() {
  const error = new Error('Photo request cancelled.');
  error.name = 'AbortError';
  return error;
}

// AbortSignal.any is not available in every supported native runtime. This also
// settles locally when fetch/arrayBuffer ignores cancellation after headers.
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function downloadSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = downloadWaiters.indexOf(admit);
      if (index >= 0) downloadWaiters.splice(index, 1);
      signal.removeEventListener('abort', abort);
      reject(cancelled());
    };
    const admit = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return abort();
      downloading++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        downloading--;
        downloadWaiters.shift()?.();
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (downloading < 3) admit();
    else downloadWaiters.push(admit);
  });
}

async function imageBytes(response: Response, signal: AbortSignal) {
  // Browsers expose streaming bodies; native fetch may provide only arrayBuffer.
  // The Storage object is already server verified and bounded, but validate the
  // received body independently and stop oversized streamed responses early.
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw cancelled();
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumImageBytes) {
        abort();
        throw new Error('Invalid photo.');
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function downloadImage(url: string, cacheSignal: AbortSignal, deadline: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  cacheSignal.addEventListener('abort', abort, { once: true });
  if (cacheSignal.aborted) abort();
  const timer = setTimeout(abort, 20000);
  let response: Response | undefined;
  let release: (() => void) | undefined;
  try {
    release = await downloadSlot(controller.signal);
    if (controller.signal.aborted) throw cancelled();
    if (!Number.isFinite(deadline) || performance.now() >= deadline)
      throw new Error('Photo access expired.');
    return await untilAbort(
      (async () => {
        response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw cancelled();
        }
        const contentType = response.headers.get('content-type')?.trim() ?? '';
        const length = response.headers.get('content-length');
        if (
          !response.ok ||
          !/^image\/jpeg(?:\s*;|$)/i.test(contentType) ||
          (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumImageBytes))
        ) {
          void response.body?.cancel().catch(() => {});
          throw new Error('Photo unavailable.');
        }
        const bytes = await imageBytes(response, controller.signal);
        if (
          bytes.length < 4 ||
          bytes.length > maximumImageBytes ||
          bytes[0] !== 0xff ||
          bytes[1] !== 0xd8 ||
          bytes[2] !== 0xff ||
          bytes[bytes.length - 2] !== 0xff ||
          bytes[bytes.length - 1] !== 0xd9
        )
          throw new Error('Invalid photo.');
        if (controller.signal.aborted) throw cancelled();
        return jpegDataUri(bytes);
      })(),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
    cacheSignal.removeEventListener('abort', abort);
    if (controller.signal.aborted) void response?.body?.cancel().catch(() => {});
    release?.();
  }
}

export function imageMemory(scope: string, resource: string, tags: readonly string[]) {
  const entry = (id: string) =>
    images.entry(`${scope}:image:${resource}:${id}`, ['media', ...tags]);
  return {
    cached(ids: string[]) {
      const result: Record<string, string> = {};
      for (const id of ids) {
        const snapshot = entry(id).getSnapshot();
        if (snapshot.data && Number.isFinite(snapshot.updatedAt)) result[id] = snapshot.data;
      }
      return result;
    },
    async resolve(
      urls: Record<string, string | null>,
      signal?: AbortSignal,
      deadline = performance.now() + 55000,
    ) {
      const result: Record<string, string | null> = {};
      // Capture entries before starting work. Invalidation, clear and logout must
      // cancel queued work rather than letting it recreate an old session's data.
      const pending = Object.entries(urls).map(([id, url]) => {
        const saved = entry(id);
        return { id, url, saved, revision: saved.getRevision() };
      });
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        await Promise.all(
          Array.from({ length: Math.min(3, pending.length) }, async () => {
            while (pending.length) {
              const next = pending.shift();
              if (!next) return;
              const { id, url, saved, revision } = next;
              if (
                controller.signal.aborted ||
                saved.getSnapshot().retired ||
                saved.getRevision() !== revision
              )
                throw cancelled();
              if (!url) {
                saved.clear();
                result[id] = null;
                continue;
              }
              const release = saved.retain();
              try {
                await untilAbort(
                  saved.read((cacheSignal) => downloadImage(url, cacheSignal, deadline), {
                    staleTime: Infinity,
                    discardOnError: () => true,
                  }),
                  controller.signal,
                );
                const snapshot = saved.getSnapshot();
                if (
                  !snapshot.data ||
                  snapshot.error ||
                  snapshot.retired ||
                  controller.signal.aborted
                )
                  throw new Error('Photo unavailable.');
                result[id] = snapshot.data;
              } finally {
                release();
              }
            }
          }),
        );
        return result;
      } finally {
        controller.abort();
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
