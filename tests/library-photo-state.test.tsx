import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useLibraryPhoto } from '@/features/photos/use-library-photo';
import { pickLibraryPhoto, PhotoLibraryError } from '@/features/photos/pick-library-photo';
import { preparePhoto } from '@/features/photos/photo-files';
import { photoAssignment, photoFixture, photoUser, preparedPhoto } from './photo-fixtures';

jest.mock('@/features/photos/pick-library-photo', () => ({
  ...jest.requireActual('@/features/photos/pick-library-photo'),
  pickLibraryPhoto: jest.fn(),
}));
jest.mock('@/features/photos/photo-files', () => ({ preparePhoto: jest.fn() }));

type Options = Parameters<typeof useLibraryPhoto>[0];
const picked = { uri: 'file:///cache/ImagePicker/library.heic', width: 4032, height: 3024 };
const prepared = { ...preparedPhoto, source: 'library' as const };
const picker = jest.mocked(pickLibraryPhoto);
const prepare = jest.mocked(preparePhoto);
const listeners = new Set<(state: AppStateStatus) => void>();

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
async function mounted(overrides: Partial<Options> = {}) {
  const fixture = photoFixture();
  const options: Options = {
    gateway: fixture.gateway,
    userId: photoUser,
    assignmentId: photoAssignment,
    enabled: true,
    onPrepared: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
  const hook = renderHook((props: Options) => useLibraryPhoto(props), { initialProps: options });
  await act(async () => {});
  return { ...hook, options, fixture };
}
async function appState(value: AppStateStatus) {
  await act(async () => {
    AppState.currentState = value;
    for (const listener of [...listeners]) listener(value);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  picker.mockResolvedValue(picked);
  prepare.mockResolvedValue(prepared);
});
afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = 'active';
});

it('waits for authoritative current-day eligibility before enabling library selection', async () => {
  const fixture = photoFixture();
  const eligibility = deferred<boolean>();
  fixture.gateway.canChooseLibraryPhoto.mockReturnValueOnce(eligibility.promise);
  const { result } = await mounted({ gateway: fixture.gateway });
  expect(result.current.available).toBe(false);
  await act(async () => result.current.choose());
  expect(picker).not.toHaveBeenCalled();
  await act(async () => eligibility.resolve(true));
  expect(result.current.available).toBe(true);
});

it('accepts historical library selection using the same secure preparation and server admission', async () => {
  const fixture = photoFixture(null, { captureKind: 'historical', localDate: '2026-08-01' });
  const { result, options } = await mounted({ gateway: fixture.gateway });
  expect(result.current.available).toBe(true);
  await act(async () => result.current.choose());
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledWith(picked, photoUser, photoAssignment, expect.any(Function), {
    removeSource: false,
    source: 'library',
  });
  expect(options.onPrepared).toHaveBeenCalledWith(prepared);
  expect(fixture.gateway.reserve).not.toHaveBeenCalled();
  expect(fixture.gateway.finalize).not.toHaveBeenCalled();
});

it('does not convert a cancelled historical picker into a reservation or overwrite an existing draft', async () => {
  picker.mockResolvedValueOnce(null);
  const fixture = photoFixture(null, { captureKind: 'historical' });
  const { result, options } = await mounted({ gateway: fixture.gateway });
  await act(async () => result.current.choose());
  expect(options.onPrepared).not.toHaveBeenCalled();
  expect(options.remove).not.toHaveBeenCalled();
  expect(fixture.gateway.reserve).not.toHaveBeenCalled();
  expect(result.current.error).toBe('');
});

it('rejects stale historical eligibility after switching the same assignment to another intent gateway', async () => {
  const historical = photoFixture(null, { captureKind: 'historical' });
  const eligibility = deferred<boolean>();
  historical.gateway.canChooseLibraryPhoto.mockReturnValueOnce(eligibility.promise);
  const { result, options, rerender } = await mounted({ gateway: historical.gateway });
  const daily = photoFixture();
  daily.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  rerender({ ...options, gateway: daily.gateway });
  await act(async () => eligibility.resolve(true));
  expect(result.current.available).toBe(false);
  await act(async () => result.current.choose());
  expect(picker).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it.each([false, 'failure'] as const)(
  'never opens the picker when server eligibility is %s',
  async (eligibility) => {
    const fixture = photoFixture();
    if (eligibility === false) fixture.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
    else fixture.gateway.canChooseLibraryPhoto.mockRejectedValue(new Error('unavailable'));
    const { result } = await mounted({ gateway: fixture.gateway });
    await act(async () => result.current.choose());
    expect(result.current.available).toBe(false);
    expect(picker).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  },
);

it('cancel leaves any existing preview/draft intact and does not prepare or reserve', async () => {
  picker.mockResolvedValue(null);
  const { result, options, fixture } = await mounted();
  await act(async () => result.current.choose());
  expect(prepare).not.toHaveBeenCalled();
  expect(options.onPrepared).not.toHaveBeenCalled();
  expect(options.remove).not.toHaveBeenCalled();
  expect(fixture.gateway.reserve).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBe('');
});

it('coalesces repeated taps and uses the common secure preprocessing without submitting', async () => {
  const selection = deferred<typeof picked | null>();
  picker.mockReturnValueOnce(selection.promise);
  const { result, options, fixture } = await mounted();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.choose();
    void result.current.choose();
    void result.current.choose();
  });
  expect(picker).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(true);
  await act(async () => {
    selection.resolve(picked);
    await pending;
  });
  expect(prepare).toHaveBeenCalledWith(picked, photoUser, photoAssignment, expect.any(Function), {
    removeSource: false,
    source: 'library',
  });
  expect(options.onPrepared).toHaveBeenCalledTimes(1);
  expect(options.onPrepared).toHaveBeenCalledWith(prepared);
  expect(options.remove).not.toHaveBeenCalled();
  expect(fixture.gateway.reserve).not.toHaveBeenCalled();
  expect(fixture.gateway.upload).not.toHaveBeenCalled();
  expect(fixture.gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
});

it.each(['inactive', 'background'] as const)(
  'holds a selected image during %s until the app is active again',
  async (state) => {
    const selection = deferred<typeof picked | null>();
    picker.mockReturnValueOnce(selection.promise);
    const { result, options, fixture } = await mounted();
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.choose();
    });
    await appState(state);
    await act(async () => selection.resolve(picked));
    expect(prepare).not.toHaveBeenCalled();
    expect(options.onPrepared).not.toHaveBeenCalled();
    expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
    await appState('active');
    await act(async () => pending);
    expect(options.onPrepared).toHaveBeenCalledWith(prepared);
    expect(listeners.size).toBe(0);
  },
);

it('defers a prepared preview until foreground without losing it on iOS inactive', async () => {
  const preprocessing = deferred<typeof prepared>();
  prepare.mockReturnValueOnce(preprocessing.promise);
  const { result, options } = await mounted();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.choose();
  });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  await appState('inactive');
  await act(async () => preprocessing.resolve(prepared));
  expect(options.onPrepared).not.toHaveBeenCalled();
  await appState('active');
  await act(async () => pending);
  expect(options.onPrepared).toHaveBeenCalledWith(prepared);
  expect(options.remove).not.toHaveBeenCalled();
});

it.each(['blur', 'unmount', 'gateway', 'user', 'assignment'] as const)(
  'ignores a late native picker callback after %s',
  async (change) => {
    const selection = deferred<typeof picked | null>();
    picker.mockReturnValueOnce(selection.promise);
    const { result, rerender, unmount, options } = await mounted();
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.choose();
    });
    if (change === 'unmount') unmount();
    else
      rerender({
        ...options,
        ...(change === 'blur' ? { enabled: false } : {}),
        ...(change === 'gateway' ? { gateway: photoFixture().gateway } : {}),
        ...(change === 'user' ? { userId: '45000000-0000-4000-8000-000000000009' } : {}),
        ...(change === 'assignment'
          ? { assignmentId: '45000000-0000-4000-8000-000000000008' }
          : {}),
      });
    await act(async () => {
      selection.resolve(picked);
      await pending;
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(options.onPrepared).not.toHaveBeenCalled();
    expect(options.remove).not.toHaveBeenCalled();
  },
);

it('aborts the foreground wait on screen loss and never installs the old selection later', async () => {
  const selection = deferred<typeof picked | null>();
  picker.mockReturnValueOnce(selection.promise);
  const { result, unmount, options } = await mounted();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.choose();
  });
  await appState('background');
  await act(async () => selection.resolve(picked));
  expect(listeners.size).toBe(1);
  unmount();
  await act(async () => pending);
  expect(listeners.size).toBe(0);
  await appState('active');
  expect(prepare).not.toHaveBeenCalled();
  expect(options.onPrepared).not.toHaveBeenCalled();
});

it('removes only the previous scope draft when an account changes during preprocessing', async () => {
  const preprocessing = deferred<typeof prepared>();
  prepare.mockReturnValueOnce(preprocessing.promise);
  const { result, rerender, options } = await mounted();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.choose();
  });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  const newRemove = jest.fn();
  const newPrepared = jest.fn();
  rerender({
    ...options,
    gateway: photoFixture().gateway,
    userId: '45000000-0000-4000-8000-000000000009',
    remove: newRemove,
    onPrepared: newPrepared,
  });
  await act(async () => {
    preprocessing.resolve(prepared);
    await pending;
  });
  expect(options.remove).toHaveBeenCalledTimes(1);
  expect(options.remove).toHaveBeenCalledWith(prepared.uri);
  expect(newRemove).not.toHaveBeenCalled();
  expect(options.onPrepared).not.toHaveBeenCalled();
  expect(newPrepared).not.toHaveBeenCalled();
});

it('does not prepare a photo when the server day changes while the picker is open', async () => {
  const { result, fixture, options } = await mounted();
  fixture.gateway.canChooseLibraryPhoto.mockResolvedValueOnce(false);
  await act(async () => result.current.choose());
  expect(result.current.available).toBe(false);
  expect(result.current.error).toBe(
    'This word is no longer available for a new photo. Return to Today or Past Words to refresh.',
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(options.onPrepared).not.toHaveBeenCalled();
  expect(fixture.gateway.reserve).not.toHaveBeenCalled();
});

it('surfaces only safe permission guidance and clears it after a successful explicit retry', async () => {
  picker.mockRejectedValueOnce(new PhotoLibraryError('permission'));
  const { result, options } = await mounted();
  await act(async () => result.current.choose());
  expect(result.current.permissionDenied).toBe(true);
  expect(result.current.error).toBe(new PhotoLibraryError('permission').message);
  expect(prepare).not.toHaveBeenCalled();
  await act(async () => result.current.choose());
  expect(result.current.permissionDenied).toBe(false);
  expect(result.current.error).toBe('');
  expect(options.onPrepared).toHaveBeenCalledWith(prepared);
});

it('clears the previous account permission error on a gateway change', async () => {
  picker.mockRejectedValueOnce(new PhotoLibraryError('permission'));
  const { result, options, rerender } = await mounted();
  await act(async () => result.current.choose());
  expect(result.current.permissionDenied).toBe(true);
  rerender({ ...options, gateway: photoFixture().gateway });
  await act(async () => {});
  expect(result.current.permissionDenied).toBe(false);
  expect(result.current.error).toBe('');
});

it('does not leak preprocessing errors and releases controls for another explicit attempt', async () => {
  prepare.mockRejectedValueOnce(new Error('private-source-path-and-metadata'));
  const { result } = await mounted();
  await act(async () => result.current.choose());
  expect(result.current.error).toBe(
    'This photo could not be prepared. Please try again or choose another photo.',
  );
  expect(result.current.busy).toBe(false);
  expect(result.current.permissionDenied).toBe(false);
});

it('rechecks eligibility after an explicit assignment refresh without elapsed-time polling', async () => {
  const fixture = photoFixture();
  fixture.gateway.canChooseLibraryPhoto.mockRejectedValueOnce(new Error('offline'));
  const { result, options, rerender } = await mounted({ gateway: fixture.gateway });
  expect(result.current.available).toBe(false);
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
  rerender({ ...options, eligibilityRevision: { assignmentId: photoAssignment } });
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
});

it('preserves an open picker when the same assignment refreshes on native foreground return', async () => {
  const selection = deferred<typeof picked | null>();
  picker.mockReturnValueOnce(selection.promise);
  const { result, options, rerender } = await mounted();
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.choose();
  });
  await appState('background');
  rerender({ ...options, eligibilityRevision: { assignmentId: photoAssignment } });
  await act(async () => {});
  expect(result.current.busy).toBe(true);
  await act(async () => selection.resolve(picked));
  expect(prepare).not.toHaveBeenCalled();
  await appState('active');
  await act(async () => pending);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(options.onPrepared).toHaveBeenCalledWith(prepared);
});

it('rejects a retained picker button callback from an obsolete gateway lifetime', async () => {
  const { result, options, rerender } = await mounted();
  const oldChoose = result.current.choose;
  rerender({ ...options, gateway: photoFixture().gateway });
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => oldChoose());
  expect(picker).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it('ignores a late old-scope eligibility response after an account gateway change', async () => {
  const first = photoFixture();
  const eligibility = deferred<boolean>();
  first.gateway.canChooseLibraryPhoto.mockReturnValueOnce(eligibility.promise);
  const { result, options, rerender } = await mounted({ gateway: first.gateway });
  rerender({ ...options, gateway: photoFixture().gateway });
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => eligibility.resolve(false));
  expect(result.current.available).toBe(true);
});

it('exposes a safe eligibility failure and recovers through an explicit retry', async () => {
  const fixture = photoFixture();
  fixture.gateway.canChooseLibraryPhoto.mockRejectedValueOnce(new Error('private-gateway-details'));
  const { result } = await mounted({ gateway: fixture.gateway });
  expect(result.current.eligibilityError).toBe(
    'Photo library availability could not be checked. Check your connection and try again.',
  );
  expect(result.current.available).toBe(false);
  act(() => result.current.retryEligibility());
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(result.current.eligibilityError).toBe('');
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
  expect(picker).not.toHaveBeenCalled();
});

it('never presents an unavailable historical word as a retryable network failure', async () => {
  const fixture = photoFixture();
  fixture.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  const { result } = await mounted({ gateway: fixture.gateway });
  expect(result.current.eligibilityError).toBe('');
  act(() => result.current.retryEligibility());
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
  expect(result.current.available).toBe(false);
});

it('coalesces duplicate retry taps before render and throughout the pending read', async () => {
  const fixture = photoFixture();
  fixture.gateway.canChooseLibraryPhoto.mockRejectedValueOnce(new Error('offline'));
  const { result } = await mounted({ gateway: fixture.gateway });
  const eligibility = deferred<boolean>();
  fixture.gateway.canChooseLibraryPhoto.mockReturnValueOnce(eligibility.promise);
  const retry = result.current.retryEligibility;
  act(() => {
    retry();
    retry();
    retry();
  });
  await act(async () => {});
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
  expect(result.current.available).toBe(false);
  expect(result.current.eligibilityError).toBe('');
  act(() => retry());
  expect(fixture.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
  await act(async () => eligibility.resolve(true));
  expect(result.current.available).toBe(true);
});

it('never reuses previous-account eligibility while the new account read is pending', async () => {
  const { result, options, rerender } = await mounted();
  expect(result.current.available).toBe(true);
  const second = photoFixture();
  const eligibility = deferred<boolean>();
  second.gateway.canChooseLibraryPhoto.mockReturnValueOnce(eligibility.promise);
  rerender({ ...options, gateway: second.gateway });
  expect(result.current.available).toBe(false);
  expect(result.current.eligibilityError).toBe('');
  await act(async () => result.current.choose());
  expect(picker).not.toHaveBeenCalled();
  await act(async () => eligibility.resolve(false));
  expect(result.current.available).toBe(false);
});

it('clears a previous account eligibility error and rejects its retained retry callback', async () => {
  const first = photoFixture();
  first.gateway.canChooseLibraryPhoto.mockRejectedValueOnce(new Error('offline'));
  const { result, options, rerender } = await mounted({ gateway: first.gateway });
  const retry = result.current.retryEligibility;
  const second = photoFixture();
  rerender({ ...options, gateway: second.gateway });
  expect(result.current.eligibilityError).toBe('');
  await waitFor(() => expect(result.current.available).toBe(true));
  act(() => retry());
  expect(first.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
  expect(second.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
});

it('aborts an explicitly superseded eligibility read and discards its late result', async () => {
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const signals: AbortSignal[] = [];
  const gateway = {
    ...photoFixture().gateway,
    canChooseLibraryPhoto: jest.fn((signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    }),
  };
  const { result, options, rerender } = await mounted({ gateway });
  rerender({ ...options, eligibilityRevision: {} });
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  await act(async () => first.resolve(true));
  expect(result.current.available).toBe(false);
  await act(async () => second.resolve(false));
  expect(result.current.available).toBe(false);
  expect(result.current.eligibilityError).toBe('');
});
