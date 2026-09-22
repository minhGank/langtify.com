import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AppState, FlatList, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoverScreen } from '@/features/discover/discover-screen';
import { PostScreen } from '@/features/discover/post-screen';
import { postScreenOptions } from '@/features/discover/navigation-options';
import { invalidateServerData } from '@/lib/server-cache';
import type { FeedItem } from '@/services/discover';
import type { RatingSummary } from '@/features/ratings/rating';
import { makeAccount, makeSession } from './fixtures';

let mockSession = makeSession(),
  mockAccount = makeAccount();
const item: FeedItem = {
  id: '77000000-0000-4000-8000-000000000001',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'learner',
  submittedAt: '2026-09-13T12:00:00Z',
  canRate: true,
  viewerRating: null,
  averageRating: null,
  ratingCount: 0,
};
let mockItem = item;
const mockLoad = jest.fn(),
  mockPreviews = jest.fn(),
  mockRate = jest.fn(),
  mockGateway = jest.fn();
const mockPhotos = () => ({ [item.id]: 'data:image/jpeg;base64,cGl4ZWxz' });
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    status: 'ready',
    session: mockSession,
    account: mockAccount,
    reload: jest.fn(),
  }),
}));
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: (...args: unknown[]) => {
    mockGateway(...args);
    return { load: mockLoad, previews: mockPreviews, rate: mockRate, cachedPreviews: mockPhotos };
  },
}));
jest.mock('@/services/social', () => ({
  socialGateway: () => ({ comments: async () => ({ items: [], hasMore: false }) }),
}));
function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="post" options={postScreenOptions} />
    </Stack>
  );
}
const routes = {
  _layout: Layout,
  discover: DiscoverScreen,
  post: PostScreen,
  'public-profile': () => <Text>Profile</Text>,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockAccount = makeAccount();
  mockItem = { ...item };
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockLoad.mockReset().mockImplementation(async () => ({ items: [mockItem], hasMore: false }));
  mockPreviews
    .mockReset()
    .mockImplementation(async () => ({ items: [mockItem], photos: mockPhotos() }));
  mockRate.mockReset().mockImplementation(async (_id: string, score: 1 | 2 | 3 | 4 | 5) => {
    mockItem = { ...mockItem, viewerRating: score, averageRating: score, ratingCount: 1 };
    return { viewerRating: score, averageRating: score, ratingCount: 1, canRate: mockItem.canRate };
  });
});
it('pushes native detail and returns to the mounted feed without another read or signing request', async () => {
  const app = renderRouter(routes, { initialUrl: '/discover' });
  await screen.findByText('Le chien');
  const feed = screen.UNSAFE_getByType(FlatList);
  fireEvent.press(screen.getByLabelText('Open photo: Le chien'));
  expect(await screen.findByText('How well does this photo represent “Le chien”?')).toBeVisible();
  expect(app.getPathname()).toBe('/post');
  expect(app.getSearchParams()).toEqual({ submissionId: item.id });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledTimes(1);
  expect(postScreenOptions).toMatchObject({
    gestureEnabled: true,
    presentation: 'card',
    headerShown: true,
  });
  const safe = screen
    .UNSAFE_getAllByType(SafeAreaView)
    .find((node) => node.props.edges?.includes('bottom'));
  expect(safe?.props.edges).toEqual(['left', 'right', 'bottom']);
  act(() => router.back());
  expect(await screen.findByText('Le chien')).toBeVisible();
  expect(app.getPathname()).toBe('/discover');
  expect(screen.UNSAFE_getByType(FlatList)).toBe(feed);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledTimes(1);
});
it('shares authoritative votes between quick rating, native detail and the preserved feed', async () => {
  const app = renderRouter(routes, { initialUrl: '/discover' });
  fireEvent.press(await screen.findByLabelText('Rate photo: Le chien'));
  fireEvent.press(screen.getByLabelText('4 — Clear match for Le chien'));
  await screen.findByLabelText('Your rating: 4 — Clear match. Edit rating for Le chien');
  fireEvent.press(screen.getByLabelText('Open photo: Le chien'));
  expect(await screen.findByLabelText('4 — Clear match for Le chien')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ checked: true }),
  );
  fireEvent.press(screen.getByLabelText('5 — Perfect match for Le chien'));
  await screen.findByText('Your rating: Perfect match');
  act(() => router.back());
  expect(app.getPathname()).toBe('/discover');
  expect(
    await screen.findByLabelText('Your rating: 5 — Perfect match. Edit rating for Le chien'),
  ).toBeVisible();
  expect(mockRate).toHaveBeenCalledTimes(2);
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('reauthorizes a direct post entry and supplies a fixed safe back destination', async () => {
  const app = renderRouter(routes, { initialUrl: `/post?submissionId=${item.id}` });
  await screen.findByText('Le chien');
  expect(mockGateway).toHaveBeenCalledWith(
    expect.objectContaining({ userId: mockSession.user.id }),
    { submissionId: item.id },
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Back to Discover'));
  await screen.findByLabelText('Search words and people');
  expect(app.getPathname()).toBe('/discover');
});
it('rejects malformed direct IDs without fetching or accepting route injection', async () => {
  renderRouter(routes, { initialUrl: '/post?submissionId=https%3A%2F%2Fevil.test' });
  await screen.findByText('Photo unavailable');
  expect(mockLoad).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Back to Discover')).toBeVisible();
});
it('keeps owner details non-rateable and removes a displayed post after privacy invalidation', async () => {
  mockItem = { ...item, canRate: false };
  renderRouter(routes, { initialUrl: `/post?submissionId=${item.id}` });
  await screen.findByText('Your photo — you cannot rate it.');
  expect(screen.queryByLabelText('5 — Perfect match for Le chien')).toBeNull();
  mockLoad.mockResolvedValue({ items: [], hasMore: false });
  mockPreviews.mockResolvedValue({ items: [], photos: {} });
  await act(async () => invalidateServerData(['discover'], { discard: true }));
  await screen.findByText('Photo unavailable');
  expect(screen.queryByText('Le chien')).toBeNull();
  expect(mockRate).not.toHaveBeenCalled();
});
it('keeps native detail navigation on short background while clearing inactive photo presentation', async () => {
  const changes = jest.spyOn(AppState, 'addEventListener');
  const app = renderRouter(routes, { initialUrl: `/post?submissionId=${item.id}` });
  await screen.findByLabelText('Photo of Le chien');
  const count = mockLoad.mock.calls.length;
  const listeners = changes.mock.calls.map((call) => call[1]);
  act(() => listeners.forEach((listener) => listener('background')));
  expect(screen.queryByLabelText('Photo of Le chien')).toBeNull();
  expect(app.getPathname()).toBe('/post');
  await act(async () => listeners.forEach((listener) => listener('active')));
  await screen.findByLabelText('Photo of Le chien');
  expect(mockLoad).toHaveBeenCalledTimes(count);
});
it('reconciles a detail rating interrupted by back navigation without replaying intent', async () => {
  let acknowledge: (value: RatingSummary) => void = () => {};
  mockRate.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  renderRouter(routes, { initialUrl: '/discover' });
  fireEvent.press(await screen.findByLabelText('Open photo: Le chien'));
  fireEvent.press(await screen.findByLabelText('5 — Perfect match for Le chien'));
  await waitFor(() => expect(mockRate).toHaveBeenCalledTimes(1));
  mockItem = { ...item, viewerRating: 5, averageRating: 5, ratingCount: 1 };
  act(() => router.back());
  await screen.findByLabelText('Your rating: 5 — Perfect match. Edit rating for Le chien');
  await act(async () =>
    acknowledge({ viewerRating: 5, averageRating: 5, ratingCount: 1, canRate: true }),
  );
  expect(mockRate).toHaveBeenCalledTimes(1);
});

it('does not turn an invalidated source into fresh detail metadata while source reconciliation is pending', async () => {
  renderRouter(routes, { initialUrl: '/discover' });
  await screen.findByText('Le chien');
  mockLoad.mockReturnValueOnce(new Promise(() => {}));
  act(() => invalidateServerData(['discover']));
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  mockLoad.mockResolvedValue({ items: [], hasMore: false });
  mockPreviews.mockResolvedValue({ items: [], photos: {} });
  fireEvent.press(screen.getByLabelText('Open photo: Le chien'));
  await screen.findByText('Photo unavailable');
  expect(mockLoad).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Le chien')).toBeNull();
});
