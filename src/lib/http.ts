// Keep a stalled transport from holding application controls indefinitely. This
// never retries a mutation; existing screens reconcile uncertain server outcomes.
export function timedFetch(fetcher: typeof fetch, milliseconds: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const original =
      init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : null);
    let cancel = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        controller.abort();
        const error = new Error('Network request could not be confirmed.');
        error.name = 'AbortError';
        reject(error);
      };
    });
    const timer = setTimeout(cancel, milliseconds);
    original?.addEventListener('abort', cancel, { once: true });
    try {
      if (original?.aborted) {
        cancel();
        return await cancelled;
      }
      return await Promise.race([
        fetcher(input, { ...init, signal: controller.signal }),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      original?.removeEventListener('abort', cancel);
    }
  };
}
export const boundedFetch: typeof fetch = (input, init) => {
  const address = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
  const upload =
    address.includes('/storage/v1/object/') && !['GET', 'HEAD'].includes(init?.method ?? 'GET');
  return timedFetch(fetch, upload ? 90000 : 20000)(input, init);
};
