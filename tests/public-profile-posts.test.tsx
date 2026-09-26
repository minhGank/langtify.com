import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { PublicProfilePosts } from '@/features/social/public-profile-posts';
import {
  parsePublicProfilePage,
  type FeedGateway,
  type FeedIdentity,
  type FeedItem,
} from '@/services/discover';
import { RatingUnavailable } from '@/features/ratings/rating';
import { profileCache } from '@/features/social/cache';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { makeAccount, makeSession } from './fixtures';

const mockLoad = jest.fn();
const mockOpenPost = jest.fn();
jest.mock('@/features/discover/open-post', () => ({
  openPost: (...args: unknown[]) => mockOpenPost(...args),
}));
const mockPreviews = jest.fn();
const mockRate = jest.fn();
const mockFeedGateway = jest.fn<FeedGateway, [FeedIdentity, string?]>(() => ({
  load: mockLoad,
  previews: mockPreviews,
  rate: mockRate,
}));
let mockSession = makeSession();
let mockAccount = makeAccount();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    status: 'ready',
    session: mockSession,
    account: mockAccount,
    reload: jest.fn(),
  }),
}));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: (...args: [FeedIdentity, string?]) => mockFeedGateway(...args),
}));
jest.mock('@/features/social/comments', () => ({ Comments: () => null }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));

const profileId = '99000000-0000-4000-8000-000000000009';
const item: FeedItem = {
  id: '99000000-0000-4000-8000-000000000010',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'photographer',
  submittedAt: '2026-09-21T12:00:00.123456Z',
  averageRating: null,
  ratingCount: 0,
  viewerRating: null,
  canRate: true,
};
const identity = () => ({ userId: mockSession.user.id, token: mockSession.access_token });
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockAccount = makeAccount();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockLoad.mockReset().mockResolvedValue({ items: [item], hasMore: false });
  mockPreviews.mockReset().mockImplementation(async (ids: string[]) => ({
    items: ids.map((id) => ({ ...item, id })),
    photos: Object.fromEntries(ids.map((id) => [id, 'data:image/jpeg;base64,/9g='])),
  }));
});

it('loads the selected public profile in the saved language and opens its existing post experience', async () => {
  render(<PublicProfilePosts identity={identity()} profileId={profileId} />);
  expect(await screen.findByText('Le chien')).toBeVisible();
  expect(screen.getByText('French')).toBeVisible();
  expect(mockFeedGateway).toHaveBeenCalledWith(
    { ...identity(), targetLanguageId: 'fr' },
    profileId,
  );
  expect(mockPreviews).toHaveBeenCalledWith([item.id], expect.any(AbortSignal));
  fireEvent.press(screen.getByLabelText('View Le chien'));
  expect(mockOpenPost).toHaveBeenCalledWith({ ...identity(), targetLanguageId: 'fr' }, item);
  expect(screen.queryByText('Refresh public photos')).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it('shows owner public posts without offering self-rating', async () => {
  mockPreviews.mockResolvedValue({
    items: [{ ...item, canRate: false }],
    photos: { [item.id]: 'data:image/jpeg;base64,/9g=' },
  });
  render(
    <PublicProfilePosts identity={identity()} profileId="99000000-0000-4000-8000-000000000001" />,
  );
  fireEvent.press(await screen.findByLabelText('View Le chien'));
  expect(mockOpenPost).toHaveBeenCalledWith(
    { ...identity(), targetLanguageId: 'fr' },
    { ...item, canRate: false },
  );
});

it('advances profile pagination with the authoritative timestamp and ID without repeating rows', async () => {
  mockLoad
    .mockResolvedValueOnce({ items: [item], hasMore: true })
    .mockResolvedValueOnce({ items: [{ ...item, id: 'older' }], hasMore: false });
  render(<PublicProfilePosts identity={identity()} profileId={profileId} />);
  fireEvent.press(await screen.findByText('More public photos'));
  await waitFor(() => expect(screen.getAllByText('Le chien')).toHaveLength(2));
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: item.submittedAt, id: item.id },
    expect.any(AbortSignal),
  );
  expect(screen.queryByText('More public photos')).toBeNull();
});

it('clears public posts when invalidated eligibility is denied by a block or restriction', async () => {
  const parentProfile = profileCache.entry(
    `${serverScope(identity().userId, identity().token)}:profile:${profileId}`,
    ['public-profile'],
  );
  parentProfile.set({
    id: profileId,
    username: 'photographer',
    isSelf: false,
    isFollowing: false,
    followerCount: 0,
    followingCount: 0,
    avatarId: null,
  });
  render(<PublicProfilePosts identity={identity()} profileId={profileId} />);
  await screen.findByText('Le chien');
  mockLoad.mockRejectedValueOnce(new RatingUnavailable('Profile unavailable.'));
  act(() =>
    invalidateServerData(['discover'], { scope: serverScope(identity().userId, identity().token) }),
  );
  await screen.findByText('We couldn’t load these photos. Try again.');
  expect(screen.queryByText('Le chien')).toBeNull();
  expect(screen.queryByLabelText('Photo of Le chien')).toBeNull();
  expect(parentProfile.getSnapshot().data).toBeNull();
});

it('does not install a late public photo result after switching accounts', async () => {
  let finish: (value: { items: FeedItem[]; hasMore: boolean }) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const initial = identity();
  const view = render(<PublicProfilePosts identity={initial} profileId={profileId} />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockLoad.mock.calls[0][1];
  mockSession = makeSession('another-account');
  mockAccount = makeAccount('another-account');
  view.rerender(<PublicProfilePosts identity={initial} profileId={profileId} />);
  await act(async () => finish({ items: [item], hasMore: false }));
  expect(signal.aborted).toBe(true);
  expect(mockPreviews).not.toHaveBeenCalled();
  expect(screen.queryByText('Le chien')).toBeNull();
});

it('rejects a profile page from another public profile, account or saved language', () => {
  const viewer = { ...identity(), targetLanguageId: 'fr' };
  const payload = {
    viewer_id: viewer.userId,
    target_language_id: 'fr',
    profile_id: profileId,
    items: [],
    has_more: false,
  };
  expect(parsePublicProfilePage(payload, viewer, profileId)).toEqual({ items: [], hasMore: false });
  expect(() =>
    parsePublicProfilePage({ ...payload, profile_id: 'other' }, viewer, profileId),
  ).toThrow();
  expect(() =>
    parsePublicProfilePage({ ...payload, viewer_id: 'other' }, viewer, profileId),
  ).toThrow();
  expect(() =>
    parsePublicProfilePage({ ...payload, target_language_id: 'en' }, viewer, profileId),
  ).toThrow();
});

it.each([false, true])(
  'shows a concise empty profile for own=%s without a refresh control',
  async (isOwn) => {
    mockLoad.mockResolvedValue({ items: [], hasMore: false });
    render(<PublicProfilePosts identity={identity()} profileId={profileId} isOwn={isOwn} />);
    expect(await screen.findByText(isOwn ? 'Your photos, shared' : 'No photos yet')).toBeVisible();
    expect(screen.queryByText(/No public photos in/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh public photos' })).toBeNull();
    expect(mockLoad).toHaveBeenCalledTimes(1);
  },
);
