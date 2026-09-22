import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { router } from 'expo-router';
import { ExploreScreen } from '@/features/explore/explore-screen';
import { ConceptScreen } from '@/features/explore/concept-screen';
import { PeopleResults } from '@/features/explore/people-results';
import { WordResults } from '@/features/explore/word-results';
import { wordsCache } from '@/features/explore/cache';
import { openPost } from '@/features/discover/open-post';
import { SafetyUnavailable } from '@/features/safety/model';
import { followChanged, searchCache, socialChanged } from '@/features/social/cache';
import { serverScope } from '@/lib/server-cache';
import type { ExploreWord } from '@/services/explore';
import { makeAccount, makeSession } from './fixtures';

const mockWords = jest.fn(),
  mockConcept = jest.fn(),
  mockPeople = jest.fn(),
  mockAvatars = jest.fn();
const mockLoad = jest.fn(),
  mockPreviews = jest.fn(),
  mockRate = jest.fn();
let mockSession = makeSession(),
  mockAccount = makeAccount();
let mockParams: { conceptId?: string | string[] } = {};
const mockPixels: Record<string, string> = {};
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession, account: mockAccount }),
}));
jest.mock('@/services/explore', () => ({
  exploreGateway: () => ({
    words: mockWords,
    concept: mockConcept,
    examples: () => ({
      load: mockLoad,
      previews: mockPreviews,
      rate: mockRate,
      cachedPreviews: (ids: string[]) =>
        Object.fromEntries(ids.flatMap((id) => (mockPixels[id] ? [[id, mockPixels[id]]] : []))),
    }),
  }),
}));
jest.mock('@/services/social', () => ({
  ...jest.requireActual('@/services/social'),
  socialGateway: () => ({ search: mockPeople }),
}));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => ({ previews: mockAvatars }) }));
jest.mock('@/features/discover/open-post', () => ({ openPost: jest.fn() }));
jest.mock('@/lib/image-memory', () => ({
  imageMemory: () => ({
    cached: () => ({}),
    resolve: async (urls: Record<string, string>) =>
      Object.fromEntries(Object.keys(urls).map((id) => [id, 'data:image/jpeg;base64,/9j/2Q=='])),
  }),
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = (n: number) => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const word = (n = 1): ExploreWord => ({
  conceptId: id(n),
  targetTerm: n === 1 ? 'le chien' : `mot ${n}`,
  referenceTerm: n === 1 ? 'dog' : `word ${n}`,
  cefrLevel: 'A1',
});
const person = (n = 1) => ({
  id: id(n),
  username: `learner${n}`,
  avatarId: id(n + 100),
  isSelf: false,
  isFollowing: n === 1,
});
const identity = () => ({
  userId: mockSession.user.id,
  token: mockSession.access_token,
  targetLanguageId: 'fr',
  referenceLanguageId: 'en',
});
const post = {
  id: id(8),
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'learner',
  submittedAt: '2026-09-22T10:00:00Z',
  averageRating: 4,
  ratingCount: 2,
  viewerRating: null,
  canRate: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockAccount = makeAccount();
  mockParams = { conceptId: id(1) };
  Object.keys(mockPixels).forEach((key) => delete mockPixels[key]);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockWords.mockReset().mockResolvedValue({ items: [word()], hasMore: false });
  mockConcept.mockReset().mockResolvedValue(word());
  mockPeople.mockReset().mockResolvedValue({ items: [person()], hasMore: false });
  mockAvatars
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, 'https://controlled.example/sign'])),
    );
  mockLoad.mockReset().mockResolvedValue({ items: [post], hasMore: false });
  mockPreviews.mockReset().mockImplementation(async (ids: string[]) => {
    for (const id of ids) mockPixels[id] = 'data:image/jpeg;base64,/9j/2Q==';
    return { items: ids.includes(post.id) ? [post] : [], photos: mockPixels };
  });
});
afterEach(() => jest.useRealTimers());

it('debounces word input, displays translation and CEFR, and opens only the concept ID', async () => {
  jest.useFakeTimers();
  render(<ExploreScreen />);
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'ch');
  await act(async () => jest.advanceTimersByTime(200));
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'chien');
  await act(async () => jest.advanceTimersByTime(349));
  expect(mockWords).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(mockWords).toHaveBeenCalledWith('chien', null, expect.any(AbortSignal));
  expect(screen.getByText('Le chien')).toBeVisible();
  expect(screen.getByText('dog')).toBeVisible();
  expect(screen.getByText('A1')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Explore Le chien'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/explore-concept',
    params: { conceptId: id(1) },
  });
});
it('cancels obsolete search immediately and never installs its late response', async () => {
  jest.useFakeTimers();
  let finish = (_: unknown) => {};
  mockWords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ExploreScreen />);
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'chien');
  await act(async () => jest.advanceTimersByTime(350));
  const signal: AbortSignal = mockWords.mock.calls[0][2];
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'chat');
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [word()], hasMore: false }));
  expect(screen.queryByText('Le chien')).toBeNull();
  mockWords.mockResolvedValue({ items: [word(2)], hasMore: false });
  await act(async () => jest.advanceTimersByTime(350));
  expect(screen.getByText('Mot 2')).toBeVisible();
});
it('separates People, shows relationship state and uses one avatar batch', async () => {
  jest.useFakeTimers();
  render(<ExploreScreen />);
  fireEvent.press(screen.getByRole('tab', { name: 'People' }));
  fireEvent.changeText(screen.getByLabelText('Search usernames'), 'lea');
  await act(async () => jest.advanceTimersByTime(350));
  expect(screen.getByText('Following')).toBeVisible();
  expect(mockWords).not.toHaveBeenCalled();
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('View @learner1'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/public-profile',
    params: { profileId: id(1) },
  });
});
it('keeps cached word pages on return and only refreshes explicitly', async () => {
  const view = render(<WordResults identity={identity()} query="chien" />);
  await screen.findByText('Le chien');
  view.unmount();
  const time = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 36000000);
  const revisit = render(<WordResults identity={identity()} query="chien" />);
  await screen.findByText('Le chien');
  expect(mockWords).toHaveBeenCalledTimes(1);
  fireEvent(revisit.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(mockWords).toHaveBeenCalledTimes(2));
  time.mockRestore();
});
it('paginates with untouched stored terms, deduplicates and bounds the retained word window', async () => {
  mockWords
    .mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, i) => word(i + 1)),
      hasMore: true,
    })
    .mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, i) => word(i + 20)),
      hasMore: true,
    })
    .mockResolvedValueOnce({
      items: Array.from({ length: 20 }, (_, i) => word(i + 40)),
      hasMore: false,
    });
  const view = render(<WordResults identity={identity()} query="mo" />);
  fireEvent.press(await screen.findByText('More results'));
  await waitFor(() => expect(mockWords).toHaveBeenCalledTimes(2));
  expect(mockWords).toHaveBeenLastCalledWith(
    'mo',
    { term: 'mot 20', id: id(20) },
    expect.any(AbortSignal),
  );
  fireEvent.press(screen.getByText('More results'));
  await screen.findByText('Back to first results');
  expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(40);
});
it('shows empty and denied results without retaining blocked profiles in related caches', async () => {
  mockPeople.mockResolvedValueOnce({ items: [], hasMore: false });
  const view = render(<PeopleResults identity={identity()} query="none" />);
  await screen.findByText('No matching learners');
  view.unmount();
  mockPeople.mockResolvedValueOnce({ items: [person()], hasMore: false });
  render(<PeopleResults identity={identity()} query="lea" />);
  await screen.findByText('@learner1');
  mockPeople.mockRejectedValue(new SafetyUnavailable());
  act(() => socialChanged('block'));
  await screen.findByText('Search unavailable');
  expect(screen.queryByText('@learner1')).toBeNull();
});
it('patches loaded People relationship state after a confirmed follow without refetch', async () => {
  mockPeople.mockResolvedValue({ items: [{ ...person(), isFollowing: false }], hasMore: false });
  render(<PeopleResults identity={identity()} query="lea" />);
  await screen.findByText('Not following');
  act(() =>
    followChanged(identity(), {
      profile: { ...person(), isFollowing: true, followerCount: 2, followingCount: 0 },
      viewerProfile: { ...person(2), isSelf: true, followerCount: 0, followingCount: 1 },
      followedAt: '2026-09-22T10:00:00Z',
    }),
  );
  expect(screen.getByText('Following')).toBeVisible();
  expect(mockPeople).toHaveBeenCalledTimes(1);
});
it('isolates search results on account switch and rejects old pending results', async () => {
  jest.useFakeTimers();
  let finish = (_: unknown) => {};
  mockWords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ExploreScreen />);
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'chien');
  await act(async () => jest.advanceTimersByTime(350));
  const signal: AbortSignal = mockWords.mock.calls[0][2];
  mockSession = makeSession('another');
  view.rerender(<ExploreScreen />);
  await act(async () => finish({ items: [word()], hasMore: false }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Le chien')).toBeNull();
  expect(screen.getByLabelText('Search vocabulary')).toHaveProp('value', '');
});
it('opens controlled public examples using the existing batched feed and post navigation', async () => {
  render(<ConceptScreen />);
  await screen.findByLabelText('Open photo: Le chien');
  expect(mockPreviews).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledWith([post.id], expect.any(AbortSignal));
  fireEvent.press(screen.getByLabelText('Open photo: Le chien'));
  expect(openPost).toHaveBeenCalledWith(identity(), post);
});
it('does not load examples for an unavailable or injected concept', async () => {
  mockConcept.mockResolvedValueOnce(null);
  const view = render(<ConceptScreen />);
  await screen.findByText('This word is unavailable.');
  expect(mockLoad).not.toHaveBeenCalled();
  view.unmount();
  mockParams = { conceptId: 'https://evil.example' };
  render(<ConceptScreen />);
  expect(mockConcept).toHaveBeenCalledTimes(1);
  expect(mockLoad).not.toHaveBeenCalled();
});
it('keeps other-account People cache untouched by confirmed follow receipts', () => {
  const own = searchCache.entry(`${serverScope(identity().userId, identity().token)}:people:lea`, [
    'user-search',
  ]);
  own.set({ items: [person()], hasMore: false });
  const other = searchCache.entry('other:session:people:lea', ['user-search']);
  other.set({ items: [person()], hasMore: false });
  followChanged(identity(), {
    profile: { ...person(), isFollowing: false, followerCount: 0, followingCount: 0 },
    viewerProfile: { ...person(2), isSelf: true, followerCount: 0, followingCount: 0 },
    followedAt: null,
  });
  expect(own.getSnapshot().data?.items[0].isFollowing).toBe(false);
  expect(other.getSnapshot().data?.items[0].isFollowing).toBe(true);
});

it('paginates People without duplicate rows and retains the window when returning from a profile', async () => {
  mockPeople
    .mockResolvedValueOnce({ items: [person(1)], hasMore: true })
    .mockResolvedValueOnce({ items: [person(1), person(2)], hasMore: false });
  const view = render(<PeopleResults identity={identity()} query="lea" />);
  fireEvent.press(await screen.findByText('More results'));
  await screen.findByText('@learner2');
  expect(screen.getAllByText('@learner1')).toHaveLength(1);
  expect(mockPeople).toHaveBeenLastCalledWith(
    'lea',
    { username: 'learner1', id: id(1) },
    expect.any(AbortSignal),
  );
  view.unmount();
  render(<PeopleResults identity={identity()} query="lea" />);
  await screen.findByText('@learner2');
  expect(mockPeople).toHaveBeenCalledTimes(2);
});

it('clears search input and target results when saved learning languages change', async () => {
  jest.useFakeTimers();
  const view = render(<ExploreScreen />);
  fireEvent.changeText(screen.getByLabelText('Search vocabulary'), 'chien');
  await act(async () => jest.advanceTimersByTime(350));
  expect(screen.getByText('Le chien')).toBeVisible();
  mockAccount = {
    ...mockAccount,
    learning: { ...mockAccount.learning!, target_language_id: 'de' },
  };
  view.rerender(<ExploreScreen />);
  expect(screen.queryByText('Le chien')).toBeNull();
  expect(screen.getByLabelText('Search vocabulary')).toHaveProp('value', '');
  expect(mockWords).toHaveBeenCalledTimes(1);
});

function olderSearch(kind: 'words' | 'people') {
  const scope = serverScope(identity().userId, identity().token);
  if (kind === 'words') {
    wordsCache.entry(`${scope}:words:fr:en:lea`, ['explore', 'user-search']).set({
      items: [word(30)],
      hasMore: false,
      fromStart: false,
      cursor: { term: 'mot 30', id: id(30) },
    });
  } else {
    searchCache.entry(`${scope}:people:lea`, ['user-search', 'follows']).set({
      items: [person(30)],
      hasMore: false,
      fromStart: false,
      cursor: { username: 'learner30', id: id(30) },
    });
  }
  return {
    gateway: kind === 'words' ? mockWords : mockPeople,
    newest: { items: kind === 'words' ? [word()] : [person()], hasMore: false },
    screen: () =>
      kind === 'words' ? (
        <WordResults identity={identity()} query="lea" />
      ) : (
        <PeopleResults identity={identity()} query="lea" />
      ),
  };
}

it.each(['words', 'people'] as const)(
  'returns %s to the top only after a successful explicit first-page refresh',
  async (kind) => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    const search = olderSearch(kind);
    let finish = () => {};
    search.gateway.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve(search.newest);
      }),
    );
    const first = render(search.screen());
    expect(scroll).not.toHaveBeenCalled();
    expect(search.gateway).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Back to first results'));
    await waitFor(() => expect(search.gateway).toHaveBeenCalledTimes(1));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(screen.queryByText('Back to first results')).toBeNull();
    first.unmount();
    render(search.screen());
    await act(async () => {});
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(search.gateway).toHaveBeenCalledTimes(1);
  },
);

it.each(['words', 'people'] as const)(
  'keeps the older %s position when an explicit refresh fails',
  async (kind) => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    const search = olderSearch(kind);
    search.gateway.mockRejectedValueOnce(new Error('Offline'));
    render(search.screen());
    fireEvent.press(screen.getByText('Back to first results'));
    await screen.findByText('Retry search');
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByText('Back to first results')).toBeVisible();
  },
);

it.each(['words', 'people'] as const)(
  'does not scroll a new account after an obsolete %s refresh resolves',
  async (kind) => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    const search = olderSearch(kind);
    let finish = () => {};
    search.gateway.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve(search.newest);
      }),
    );
    const old = render(search.screen());
    fireEvent.press(screen.getByText('Back to first results'));
    await waitFor(() => expect(search.gateway).toHaveBeenCalledTimes(1));
    old.unmount();
    mockSession = makeSession('new-account');
    render(search.screen());
    await waitFor(() => expect(search.gateway).toHaveBeenCalledTimes(2));
    await act(async () => finish());
    expect(scroll).not.toHaveBeenCalled();
  },
);
