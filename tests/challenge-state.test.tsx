import { act, renderHook } from '@testing-library/react-native';
import { useTodayChallenge } from '@/features/challenges/use-today-challenge';
import type { ChallengeGateway, TodayChallenge } from '@/services/challenges';
import { makeChallenge } from './challenge-fixtures';
function fixture() {
  return {
    load: jest.fn<Promise<TodayChallenge>, []>().mockResolvedValue(makeChallenge()),
    replace: jest.fn<Promise<TodayChallenge>, [string]>().mockResolvedValue(makeChallenge()),
  } satisfies ChallengeGateway;
}
it('loads authoritative data and retries a controlled empty pool', async () => {
  const gateway = fixture();
  gateway.load.mockRejectedValueOnce({ message: 'insufficient_vocabulary' });
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.challenge).toBeNull();
  expect(result.current.error).toContain('not enough eligible');
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.challenge?.words).toHaveLength(3);
});
it('preserves the saved card on a failed replacement and allows retry', async () => {
  const gateway = fixture();
  gateway.replace.mockRejectedValueOnce({ message: 'insufficient_vocabulary' });
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
    await result.current.replace('assignment-review');
  });
  expect(result.current.challenge).toEqual(makeChallenge());
  expect(result.current.replacementError).toContain('current word is unchanged');
  await act(async () => {
    await result.current.replace('assignment-review');
  });
  expect(result.current.replacementError).toBe('');
});
it('ignores an old account response after the gateway changes', async () => {
  const first = fixture(),
    second = fixture();
  second.load.mockResolvedValue(makeChallenge('other'));
  let resolve: (value: TodayChallenge) => void = () => {};
  first.load.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: ChallengeGateway }) => useTodayChallenge(gateway),
    {
      initialProps: { gateway: first },
    },
  );
  act(() => {
    void result.current.refresh();
  });
  rerender({ gateway: second });
  await act(async () => {
    await result.current.refresh();
    resolve(makeChallenge());
  });
  expect(result.current.challenge).toEqual(makeChallenge('other'));
});
it('blocks duplicate replacements and background polling during an in-flight write', async () => {
  const gateway = fixture();
  let resolve: (value: TodayChallenge) => void = () => {};
  gateway.replace.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.replace('assignment-review');
    void result.current.replace('assignment-review');
    void result.current.refresh(true);
  });
  expect(gateway.replace).toHaveBeenCalledTimes(1);
  expect(gateway.load).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(makeChallenge());
  });
});
it('does not apply a late replacement after unmount', async () => {
  const gateway = fixture();
  let resolve: (value: TodayChallenge) => void = () => {};
  gateway.replace.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, unmount } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.replace('assignment-review');
  });
  unmount();
  await act(async () => {
    resolve(makeChallenge());
  });
  expect(result.current.replacing).toBe('assignment-review');
});

it('accepts replacement while a background read is pending and discards that old read', async () => {
  const gateway = fixture();
  let finishRead: (value: TodayChallenge) => void = () => {};
  const updated = { ...makeChallenge(), id: 'after-replacement' };
  gateway.load.mockResolvedValueOnce(makeChallenge()).mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  gateway.replace.mockResolvedValueOnce(updated);
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.refresh(true);
  });
  await act(async () => {
    await result.current.replace('assignment-review');
  });
  expect(gateway.replace).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishRead(makeChallenge());
  });
  expect(result.current.challenge).toEqual(updated);
});

it('queues a foreground refresh until the pending replacement settles', async () => {
  const gateway = fixture();
  let finishWrite: (value: TodayChallenge) => void = () => {};
  const updated = { ...makeChallenge(), id: 'after-replacement' };
  gateway.replace.mockReturnValueOnce(
    new Promise((resolve) => {
      finishWrite = resolve;
    }),
  );
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.replace('assignment-review');
    void result.current.refresh();
  });
  expect(gateway.load).toHaveBeenCalledTimes(1);
  gateway.load.mockResolvedValueOnce(updated);
  await act(async () => {
    finishWrite(updated);
  });
  expect(gateway.load).toHaveBeenCalledTimes(2);
  expect(result.current.challenge).toEqual(updated);
});

it('reconciles a pending write with the refreshed-token gateway', async () => {
  const first = fixture();
  const refreshed = fixture();
  const updated = { ...makeChallenge(), id: 'newest-saved-state' };
  refreshed.load.mockResolvedValue(updated);
  let finish: (value: TodayChallenge) => void = () => {};
  first.replace.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: ChallengeGateway }) => useTodayChallenge(gateway),
    { initialProps: { gateway: first } },
  );
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.replace('assignment-review');
  });
  rerender({ gateway: refreshed });
  act(() => {
    void result.current.refresh();
  });
  expect(refreshed.load).not.toHaveBeenCalled();
  await act(async () => {
    finish(makeChallenge());
  });
  expect(refreshed.load).toHaveBeenCalledTimes(1);
  expect(result.current.challenge).toEqual(updated);
});

it('still runs a queued refresh when the write response fails', async () => {
  const gateway = fixture();
  let reject: (error: Error) => void = () => {};
  gateway.replace.mockReturnValueOnce(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  const { result } = renderHook(() => useTodayChallenge(gateway));
  await act(async () => {
    await result.current.refresh();
  });
  act(() => {
    void result.current.replace('assignment-review');
    void result.current.refresh();
  });
  const saved = { ...makeChallenge(), id: 'committed-but-response-lost' };
  gateway.load.mockResolvedValueOnce(saved);
  await act(async () => {
    reject(new Error('Connection lost'));
  });
  expect(result.current.challenge).toEqual(saved);
  expect(result.current.replacing).toBeNull();
});
