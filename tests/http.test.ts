import { timedFetch } from '@/lib/http';
it('times out a stalled transport without retrying and ignores its late success', async () => {
  jest.useFakeTimers();
  try {
    let finish: (value: Response) => void = () => {};
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const request = timedFetch(fetcher, 100)('https://api.test');
    const rejected = expect(request).rejects.toThrow('could not be confirmed');
    jest.advanceTimersByTime(100);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish(new Response('{}'));
    await Promise.resolve();
  } finally {
    jest.useRealTimers();
  }
});
it('preserves caller cancellation and does not start an already-cancelled request', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(),
    controller = new AbortController();
  controller.abort();
  await expect(
    timedFetch(fetcher, 100)('https://api.test', { signal: controller.signal }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
