import type * as ReactTypes from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { VocabularyScreen } from '@/features/vocabulary/vocabulary-screen';
import { useVocabulary } from '@/features/vocabulary/use-vocabulary';
import {
  parseVocabularyPage,
  parseVocabularyPreviews,
  type Capture,
  type VocabularyGateway,
  type VocabularyPage,
} from '@/services/vocabulary';
import { makeSession } from './fixtures';
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));

let mockSession = makeSession();
let mockStatus = 'ready';
let mockParams: { conceptId?: string } = {};
const mockGatewayArgs = jest.fn();
const mockBack = jest.fn(),
  mockReplace = jest.fn();
const mockLoad = jest.fn(),
  mockPreviews = jest.fn(),
  mockPush = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: mockSession, status: mockStatus }),
}));
jest.mock('@/services/vocabulary', () => ({
  ...jest.requireActual('@/services/vocabulary'),
  vocabularyGateway: (...args: unknown[]) => {
    mockGatewayArgs(...args);
    return { load: mockLoad, previews: mockPreviews };
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    canGoBack: () => false,
    back: () => mockBack(),
    replace: (path: string) => mockReplace(path),
  },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const capture: Capture = {
  id: 'photo',
  conceptId: 'concept',
  assignmentId: 'assignment',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  submittedAt: '2026-09-12T12:00:00Z',
  visibility: 'private',
  captureCount: 3,
};
const page: VocabularyPage = {
  items: [capture],
  totalConcepts: 1,
  concept: capture,
  hasMore: false,
};
const gateway: VocabularyGateway = { load: mockLoad, previews: mockPreviews };
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockSession = makeSession();
  mockStatus = 'ready';
  mockParams = {};
  mockLoad.mockResolvedValue(page);
  mockPreviews.mockResolvedValue({ photo: 'https://example.test/photo' });
});
afterEach(() => jest.useRealTimers());
it.each(['email', 'google'])(
  'uses the same owned dictionary for a %s session',
  async (provider) => {
    mockSession.user.app_metadata = { provider };
    render(<VocabularyScreen />);
    expect(await screen.findByText('1 word collected')).toBeVisible();
    expect(await screen.findByLabelText('Your photo of Le chien')).toBeVisible();
    expect(screen.getByText('Dog · A1')).toBeVisible();
    expect(screen.getByText('3 photos')).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: /^View photos: Le chien\./ }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/vocabulary-concept',
      params: { conceptId: 'concept' },
    });
    expect(mockPreviews).toHaveBeenCalledWith(['photo'], expect.any(AbortSignal));
  },
);
it('shows an empty state, network failure/retry and refresh after last deletion', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline'));
  render(<VocabularyScreen />);
  expect(await screen.findByText('We couldn’t load your vocabulary. Try again.')).toBeVisible();
  fireEvent.press(screen.getByText('Try again'));
  await screen.findByText('Le chien');
  mockLoad.mockResolvedValue({ ...page, items: [], concept: null, totalConcepts: 0 });
  fireEvent(screen.getByLabelText('My vocabulary'), 'refresh');
  expect(
    await screen.findByText('Add a photo to today’s words to start your collection.'),
  ).toBeVisible();
  expect(screen.queryByText('Le chien')).toBeNull();
});
it('replaces bounded pages with a timestamp/id cursor and returns to latest', async () => {
  mockLoad.mockResolvedValueOnce({ ...page, hasMore: true });
  const { result } = renderHook(() => useVocabulary(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mockLoad.mockResolvedValue({ ...page, items: [{ ...capture, id: 'older' }] });
  await act(async () => {
    await result.current.next();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: capture.submittedAt, id: capture.id },
    expect.any(AbortSignal),
  );
  expect(result.current.data?.items.map((item) => item.id)).toEqual(['older']);
  expect(result.current.hasPrevious).toBe(true);
  await act(async () => {
    await result.current.first();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
});
it('drops pending history and photo responses on account switch or sign-out', async () => {
  let finish: (page: VocabularyPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<VocabularyScreen />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  mockSession = makeSession('different');
  mockLoad.mockResolvedValue({ ...page, items: [], totalConcepts: 0 });
  rerender(<VocabularyScreen />);
  await screen.findByText('0 words collected');
  await act(async () => finish(page));
  expect(screen.queryByText('Le chien')).toBeNull();
  let sign: (value: Record<string, string>) => void = () => {};
  mockPreviews.mockReturnValueOnce(
    new Promise((resolve) => {
      sign = resolve;
    }),
  );
  mockLoad.mockResolvedValue(page);
  fireEvent(screen.getByLabelText('My vocabulary'), 'refresh');
  await screen.findByText('Le chien');
  mockStatus = 'signed-out';
  rerender(<VocabularyScreen />);
  await act(async () => sign({ photo: 'https://example.test/old-private-photo' }));
  expect(screen.queryByLabelText('Your photo of Le chien')).toBeNull();
});
it('retains history and downloaded photos across short resume and elapsed freshness periods', async () => {
  jest.useFakeTimers();
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result } = renderHook(() => useVocabulary(gateway));
  await act(async () => {});
  const photo = result.current.photos.photo;
  const callback = listeners.mock.calls.at(-1)?.[1];
  act(() => callback?.('background'));
  expect(result.current.photos).toEqual({});
  expect(result.current.data).toEqual(page);
  await act(async () => callback?.('active'));
  await act(async () => jest.advanceTimersByTime(20 * 60000));
  expect(result.current.photos.photo).toBe(photo);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockPreviews).toHaveBeenCalledTimes(2);
});
it('does not install expired signing responses or stale responses after token/query changes', async () => {
  jest.useFakeTimers();
  let finish: (value: Record<string, string>) => void = () => {};
  mockPreviews.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: VocabularyGateway }) => useVocabulary(gateway),
    {
      initialProps: { gateway },
    },
  );
  await act(async () => {});
  act(() => {
    jest.advanceTimersByTime(60000);
  });
  await act(async () => finish({ photo: 'expired' }));
  expect(Object.values(result.current.photos)).not.toContain('expired');
  let old: (value: VocabularyPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      old = resolve;
    }),
  );
  act(() => {
    void result.current.refresh();
  });
  const newGateway = { ...gateway, load: async () => ({ ...page, items: [] }) };
  rerender({ gateway: newGateway });
  await act(async () => {});
  await act(async () => old(page));
  expect(result.current.data?.items).toEqual([]);
});
it('rejects foreign owners/concepts and arbitrary signed paths, duplicate IDs or extra URL arguments', () => {
  const row = {
    id: 'photo',
    concept_id: 'concept',
    assignment_id: 'assignment',
    target_term: 'chien',
    reference_term: 'dog',
    cefr_level: 'A1',
    submitted_at: capture.submittedAt,
    visibility: 'private',
    capture_count: 1,
  };
  const payload = {
    user_id: 'owner',
    items: [row],
    concept: row,
    total_concepts: 1,
    has_more: false,
  };
  expect(parseVocabularyPage(payload, 'owner').items).toHaveLength(1);
  expect(() => parseVocabularyPage(payload, 'other')).toThrow();
  expect(() => parseVocabularyPage(payload, 'owner', 'different')).toThrow();
  const path = '/storage/v1/object/sign/challenge-submissions/owner/photo.jpg?token=abc.def.xyz';
  expect(
    parseVocabularyPreviews(
      { previews: [{ id: 'photo', signedPath: path }] },
      'owner',
      ['photo'],
      'https://api.test',
    ).photo,
  ).toBe('https://api.test' + path);
  for (const signedPath of [
    'https://evil.test/x',
    path.replace('owner', 'other'),
    path + '&download=1',
  ])
    expect(() =>
      parseVocabularyPreviews(
        { previews: [{ id: 'photo', signedPath }] },
        'owner',
        ['photo'],
        'https://api.test',
      ),
    ).toThrow();
});

it('submits target/reference search and CEFR filters to the same server query', async () => {
  render(<VocabularyScreen />);
  await screen.findByText('Le chien');
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), ' DOG ');
  fireEvent(screen.getByLabelText('Search vocabulary'), 'submitEditing');
  await waitFor(() =>
    expect(mockGatewayArgs).toHaveBeenLastCalledWith(
      mockSession.user.id,
      mockSession.access_token,
      { conceptId: undefined, search: 'DOG', level: '' },
    ),
  );
  fireEvent.press(screen.getByLabelText('Filter vocabulary'));
  fireEvent.press(screen.getByLabelText('A1'));
  await waitFor(() =>
    expect(mockGatewayArgs).toHaveBeenLastCalledWith(
      mockSession.user.id,
      mockSession.access_token,
      { conceptId: undefined, search: 'DOG', level: 'A1' },
    ),
  );
});
it('opens existing photo management from a concept capture without copying deletion logic', async () => {
  const conceptId = '66000000-0000-4000-8000-000000000010';
  mockParams = { conceptId };
  render(<VocabularyScreen detail />);
  expect(await screen.findByText('3 photos')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: /^Open photo: Le chien\./ }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'assignment' },
  });
});

it('does not let a periodic refresh supersede an in-flight Next page or retry the old cursor', async () => {
  jest.useFakeTimers();
  mockLoad.mockResolvedValueOnce({ ...page, hasMore: true });
  const { result } = renderHook(() => useVocabulary(gateway));
  await act(async () => {});
  let finish: (value: VocabularyPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.next();
  });
  const calls = mockLoad.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(45000);
  });
  expect(mockLoad).toHaveBeenCalledTimes(calls);
  await act(async () => finish({ ...page, items: [{ ...capture, id: 'older' }] }));
  expect(result.current.data?.items[0].id).toBe('older');
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: capture.submittedAt, id: capture.id },
    expect.any(AbortSignal),
  );
});

it('does not load private history on a background mount or background token change', async () => {
  const state = jest.replaceProperty(AppState, 'currentState', 'background');
  try {
    const listeners = jest.spyOn(AppState, 'addEventListener');
    const { result, rerender } = renderHook(
      ({ gateway }: { gateway: VocabularyGateway }) => useVocabulary(gateway),
      { initialProps: { gateway } },
    );
    await act(async () => {});
    expect(mockLoad).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    rerender({ gateway: { ...gateway } });
    await act(async () => {});
    expect(mockLoad).not.toHaveBeenCalled();
    state.replaceValue('active');
    await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
    expect(result.current.data?.items).toHaveLength(1);
  } finally {
    state.restore();
  }
});
it('ignores retained refresh callbacks after unmount', async () => {
  const { result, unmount } = renderHook(() => useVocabulary(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const refresh = result.current.refresh;
  unmount();
  const calls = mockLoad.mock.calls.length;
  await act(async () => {
    await refresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(calls);
});
it('does not extend photo validity when the device wall clock moves backward', async () => {
  jest.useFakeTimers();
  let finish: (value: Record<string, string>) => void = () => {};
  mockPreviews.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useVocabulary(gateway));
  await act(async () => {});
  act(() => {
    jest.advanceTimersByTime(61000);
    jest.setSystemTime(Date.now() - 3600000);
  });
  await act(async () => finish({ photo: 'expired-on-server' }));
  expect(result.current.photos).toEqual({});
  expect(result.current.photoError).toBe(true);
});
it('retries a failed image even if batch signing returns the same still-valid URL', async () => {
  render(<VocabularyScreen />);
  const photo = await screen.findByLabelText('Your photo of Le chien');
  fireEvent(photo, 'error');
  expect(screen.queryByLabelText('Your photo of Le chien')).toBeNull();
  fireEvent.press(screen.getByText('Reload photo'));
  expect(await screen.findByLabelText('Your photo of Le chien')).toBeVisible();
});

it('normalizes an uppercase concept deep link and provides a safe direct-entry return', async () => {
  mockParams = { conceptId: '66000000-AAAA-4000-8000-000000000010' };
  render(<VocabularyScreen detail />);
  await screen.findByText('3 photos');
  expect(mockGatewayArgs).toHaveBeenLastCalledWith(mockSession.user.id, mockSession.access_token, {
    conceptId: mockParams.conceptId?.toLowerCase(),
    search: '',
    level: '',
  });
  fireEvent.press(screen.getByRole('button', { name: 'Back to My Vocabulary' }));
  expect(mockReplace).toHaveBeenCalledWith('/vocabulary');
  expect(mockBack).not.toHaveBeenCalled();
});
it('aborts network work and ignores its late results after backgrounding', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  let finish: (value: VocabularyPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useVocabulary(gateway));
  const signal: AbortSignal = mockLoad.mock.calls[0][1];
  act(() => listeners.mock.calls.at(-1)?.[1]('background'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page));
  expect(mockPreviews).not.toHaveBeenCalled();
  expect(result.current.data).toBeNull();
});

it('rejects an old query refresh callback after a token or filter gateway changes', async () => {
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: VocabularyGateway }) => useVocabulary(gateway),
    { initialProps: { gateway } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  const oldRefresh = result.current.refresh;
  rerender({ gateway: { ...gateway, load: async () => ({ ...page, items: [] }) } });
  await waitFor(() => expect(result.current.data?.items).toEqual([]));
  const calls = mockLoad.mock.calls.length;
  await act(async () => {
    await oldRefresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(calls);
  expect(result.current.data?.items).toEqual([]);
});
