import { ReadableStream } from 'node:stream/web';

import { imageMemory } from '@/lib/image-memory';
import {
  clearServerData,
  discardServerData,
  invalidateServerData,
  setServerScope,
} from '@/lib/server-cache';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const url = (id: string) => `https://storage.test/${id}?token=temporary-test-access`;
const photo = (bytes = jpeg, contentType = 'image/jpeg') =>
  new Response(bytes.buffer, { headers: { 'content-type': contentType } });
const nativePhoto = () => {
  const response = photo();
  Object.defineProperty(response, 'body', { value: null });
  return response;
};
const flush = async () => {
  for (let tick = 0; tick < 30; tick++) await Promise.resolve();
};
let fetcher: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  jest.useFakeTimers();
  fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => photo());
});
afterEach(async () => {
  clearServerData();
  await flush();
  fetcher.mockRestore();
  jest.useRealTimers();
});

it('keeps downloaded pixels after capability expiry without fetching or retaining the URL', async () => {
  const memory = imageMemory('one', 'submission', ['discover']);
  const first = await memory.resolve({ post: url('post') }, undefined, 55000);
  expect(first.post).toBe('data:image/jpeg;base64,/9j/2Q==');
  jest.advanceTimersByTime(5 * 60 * 1000);
  expect(await memory.resolve({ post: url('expired') }, undefined, 55000)).toEqual(first);
  expect(memory.cached(['post'])).toEqual(first);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(memory.cached(['post']))).not.toContain('temporary-test-access');
});

it('never starts expired access after a wall-clock rollback', async () => {
  jest.advanceTimersByTime(101);
  jest.setSystemTime(new Date('2000-01-01T00:00:00Z'));
  const memory = imageMemory('one', 'submission', ['discover']);
  await expect(memory.resolve({ post: url('post') }, undefined, 100)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();

  let finish: (value: ArrayBuffer) => void = () => {};
  fetcher.mockImplementation(async () => {
    const response = nativePhoto();
    Object.defineProperty(response, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
    });
    return response;
  });
  const blocked = memory.resolve({ first: url('first') }, undefined, 1000);
  await flush();
  jest.advanceTimersByTime(1000);
  finish(jpeg.buffer);
  await blocked;
  await expect(memory.resolve({ second: url('second') }, undefined, 1000)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not start queued image URLs after their signing deadline', async () => {
  const completions: ((value: ArrayBuffer) => void)[] = [];
  fetcher.mockImplementation(async () => {
    const response = nativePhoto();
    Object.defineProperty(response, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => completions.push(resolve)),
    });
    return response;
  });
  const pending = imageMemory('one', 'submission', ['discover']).resolve(
    { one: url('one'), two: url('two'), three: url('three'), four: url('four') },
    undefined,
    100,
  );
  const rejected = expect(pending).rejects.toThrow();
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  jest.advanceTimersByTime(101);
  completions.forEach((finish) => finish(jpeg.buffer));
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('works without native AbortSignal.any and never starts an already-cancelled read', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  try {
    const memory = imageMemory('one', 'submission', ['discover']);
    await expect(memory.resolve({ first: url('first') })).resolves.toHaveProperty('first');
    const controller = new AbortController();
    controller.abort();
    await expect(memory.resolve({ second: url('second') }, controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor);
    else Reflect.deleteProperty(AbortSignal, 'any');
  }
});

it('bounds the complete response body, settles ignored aborts and discards late pixels', async () => {
  let finish: (value: ArrayBuffer) => void = () => {};
  fetcher.mockImplementation(async () => {
    const response = nativePhoto();
    Object.defineProperty(response, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
    });
    return response;
  });
  const memory = imageMemory('one', 'submission', ['discover']);
  const pending = memory.resolve({ post: url('post') });
  const rejection = expect(pending).rejects.toThrow();
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(20000);
  await rejection;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  finish(jpeg.buffer);
  await flush();
  expect(memory.cached(['post'])).toEqual({});
  fetcher.mockImplementation(async () => photo());
  await expect(memory.resolve({ post: url('fresh') })).resolves.toHaveProperty('post');
});

it('deduplicates overlapping readers and keeps the download alive for the remaining caller', async () => {
  let finish: (value: ArrayBuffer) => void = () => {};
  fetcher.mockImplementation(async () => {
    const response = nativePhoto();
    Object.defineProperty(response, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
    });
    return response;
  });
  const memory = imageMemory('one', 'submission', ['discover']);
  const controller = new AbortController();
  const first = memory.resolve({ post: url('post') }, controller.signal);
  const rejected = expect(first).rejects.toThrow();
  const second = memory.resolve({ post: url('post') });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  controller.abort();
  await rejected;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
  finish(jpeg.buffer);
  await expect(second).resolves.toHaveProperty('post', 'data:image/jpeg;base64,/9j/2Q==');
});

it('limits downloads across simultaneous batches to three', async () => {
  const completions: ((value: ArrayBuffer) => void)[] = [];
  let active = 0;
  let maximum = 0;
  fetcher.mockImplementation(async () => {
    active++;
    maximum = Math.max(maximum, active);
    const response = nativePhoto();
    Object.defineProperty(response, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) =>
          completions.push((bytes) => {
            active--;
            resolve(bytes);
          }),
        ),
    });
    return response;
  });
  const first = imageMemory('one', 'submission', ['discover']).resolve({
    one: url('one'),
    two: url('two'),
    three: url('three'),
  });
  const second = imageMemory('one', 'avatar', ['avatars']).resolve({
    four: url('four'),
    five: url('five'),
    six: url('six'),
  });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  completions.splice(0).forEach((finish) => finish(jpeg.buffer));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(6);
  completions.splice(0).forEach((finish) => finish(jpeg.buffer));
  await Promise.all([first, second]);
  expect(maximum).toBe(3);
});

it.each(['logout', 'invalidate', 'discard'] as const)(
  '%s cancels in-flight and queued work without recreating old-session entries',
  async (operation) => {
    setServerScope('old');
    const finishes: ((value: ArrayBuffer) => void)[] = [];
    fetcher.mockImplementation(async () => {
      const response = nativePhoto();
      Object.defineProperty(response, 'arrayBuffer', {
        value: () => new Promise<ArrayBuffer>((resolve) => finishes.push(resolve)),
      });
      return response;
    });
    const memory = imageMemory('old', 'submission', ['discover']);
    const pending = memory.resolve(
      Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`post-${i}`, url(`post-${i}`)])),
    );
    const rejected = expect(pending).rejects.toThrow();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    if (operation === 'logout') setServerScope('new');
    else if (operation === 'invalidate')
      invalidateServerData(['discover'], { discard: true, scope: 'old' });
    else discardServerData(['discover'], { scope: 'old' });
    await rejected;
    finishes.forEach((finish) => finish(jpeg.buffer));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(memory.cached(['post-0', 'post-7'])).toEqual({});
    expect(imageMemory('new', 'submission', ['discover']).cached(['post-0'])).toEqual({});
  },
);

it('clears a no-longer-eligible image and invalidates only the matching session', async () => {
  const first = imageMemory('first', 'submission', ['discover']);
  const other = imageMemory('other', 'submission', ['discover']);
  await first.resolve({ post: url('first') });
  await other.resolve({ post: url('other') });
  await expect(first.resolve({ post: null })).resolves.toEqual({ post: null });
  expect(first.cached(['post'])).toEqual({});
  expect(other.cached(['post'])).toHaveProperty('post');
  invalidateServerData(['discover'], { discard: true, scope: 'first' });
  expect(other.cached(['post'])).toHaveProperty('post');
});

it.each(['image/jpegevil', 'image/png', 'application/octet-stream'])(
  'rejects an unexpected content type: %s',
  async (contentType) => {
    fetcher.mockImplementation(async () => photo(jpeg, contentType));
    const memory = imageMemory('one', 'submission', ['discover']);
    await expect(memory.resolve({ post: url('post') })).rejects.toThrow();
    expect(memory.cached(['post'])).toEqual({});
  },
);

it('rejects non-JPEG bytes and an oversized body even when its declared length is absent', async () => {
  const memory = imageMemory('one', 'submission', ['discover']);
  fetcher.mockImplementation(async () => photo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  await expect(memory.resolve({ post: url('post') })).rejects.toThrow();
  const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
  oversized.set(jpeg);
  fetcher.mockImplementation(async () => photo(oversized));
  await expect(memory.resolve({ post: url('post') })).rejects.toThrow();
  expect(memory.cached(['post'])).toEqual({});
});

it('rejects an oversized declared content length without consuming the response body', async () => {
  const response = nativePhoto();
  response.headers.set('content-length', String(5 * 1024 * 1024 + 1));
  const read = jest.fn();
  Object.defineProperty(response, 'arrayBuffer', { value: read });
  fetcher.mockResolvedValue(response);
  await expect(
    imageMemory('one', 'submission', ['discover']).resolve({ post: url('post') }),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('cancels an oversized streamed response before reading further chunks', async () => {
  const cancel = jest.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
    },
    cancel,
  });
  const response = photo();
  Object.defineProperty(response, 'body', { value: body });
  fetcher.mockResolvedValue(response);
  await expect(
    imageMemory('one', 'submission', ['discover']).resolve({ post: url('post') }),
  ).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('bounds cached entry count and retained pixel weight', async () => {
  const memory = imageMemory('one', 'submission', ['discover']);
  for (let i = 0; i < 49; i++) await memory.resolve({ [`post-${i}`]: url(`post-${i}`) });
  expect(memory.cached(['post-0'])).toEqual({});
  expect(memory.cached(['post-48'])).toHaveProperty('post-48');
  clearServerData();
  const large = new Uint8Array(5 * 1024 * 1024);
  large.set([0xff, 0xd8, 0xff]);
  large.set([0xff, 0xd9], large.length - 2);
  fetcher.mockImplementation(async () => photo(large));
  await memory.resolve({ one: url('one'), two: url('two'), three: url('three') });
  const cached = Object.values(memory.cached(['one', 'two', 'three']));
  expect(cached.length).toBeLessThan(3);
  expect(cached.reduce((sum, uri) => sum + uri.length * 2, 0)).toBeLessThanOrEqual(
    32 * 1024 * 1024,
  );
});
