import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, View } from 'react-native';
import { ProfileIdentity } from '@/features/profile/profile-identity';
import { AvatarEditor } from '@/features/profile/avatar-editor';
import { avatarChanged, ownAvatarEntry } from '@/features/profile/avatar-state';
import { DiscoverScreen } from '@/features/discover/discover-screen';
import { PostDetail } from '@/features/discover/post-detail';
import { Comments } from '@/features/social/comments';
import { ConnectionsContent } from '@/features/social/connections-screen';
import { PublicProfilePanel } from '@/features/social/public-profile';
import { PeopleResults } from '@/features/explore/people-results';
import { InboxContent } from '@/features/inbox/inbox-screen';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { makeSession, makeAccount } from './fixtures';
import type { FeedItem } from '@/services/discover';

const id = (n: number) => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let mockSession = makeSession();
const mockAccount = makeAccount();
const mockOwn = jest.fn(),
  mockPreviews = jest.fn(),
  mockProfile = jest.fn(),
  mockSearch = jest.fn(),
  mockComments = jest.fn(),
  mockConnections = jest.fn(),
  mockFeed = jest.fn(),
  mockInbox = jest.fn();
const mockApi = {
  load: mockOwn,
  previews: mockPreviews,
  reserve: jest.fn(),
  upload: jest.fn(),
  finalize: jest.fn(),
  remove: jest.fn(),
};
const mockPick = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession, account: mockAccount }),
}));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => mockApi }));
jest.mock('@/features/profile/prepare-avatar', () => ({ pickAvatar: () => mockPick() }));
jest.mock('@/services/social', () => ({
  socialGateway: () => ({ profile: mockProfile, search: mockSearch, comments: mockComments }),
}));
jest.mock('@/services/connections', () => ({
  connectionsGateway: () => ({ load: mockConnections }),
}));
jest.mock('@/services/inbox', () => ({
  inboxGateway: () => ({
    page: mockInbox,
    openInbox: async () => ({
      openedAt: '2026-09-27T12:00:00Z',
      unreadCount: 0,
      readCursor: null,
      readStates: [],
    }),
  }),
}));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: () => ({
    load: mockFeed,
    previews: async () => ({
      items: [mockPost],
      photos: { [mockPost.id]: 'data:image/jpeg;base64,photo' },
    }),
  }),
}));
jest.mock('@/features/social/public-profile-posts', () => ({ PublicProfilePosts: () => null }));
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(effect, [effect]);
  },
}));
const mockPost: FeedItem = {
  id: id(1),
  avatarId: null,
  username: 'learner',
  canRate: false,
  viewerRating: null,
  averageRating: null,
  ratingCount: 0,
  targetTerm: 'dog',
  referenceTerm: 'chien',
  cefrLevel: 'A1',
  submittedAt: '2026-09-26T10:00:00Z',
};
const profile = {
  id: id(2),
  username: 'learner',
  avatarId: null,
  isSelf: true,
  isFollowing: false,
  followerCount: 1,
  followingCount: 1,
};
const identity = () => ({ userId: mockSession.user.id, token: mockSession.access_token });
const pixels = new Uint8Array([255, 216, 255, 217]);
const surfaces = [
  'profile',
  'discover',
  'post',
  'private-post',
  'comments',
  'search',
  'connections',
  'public-profile',
];
function Surfaces() {
  const who = identity();
  const props = {
    item: mockPost,
    language: 'French',
    userId: who.userId,
    token: who.token,
    photoRevision: 0,
    reload: jest.fn(),
    rate: jest.fn(),
    ratingAction: null,
    ratingDisabled: false,
    blocked: jest.fn(),
  };
  return (
    <>
      <View testID="profile">
        <ProfileIdentity {...who} username="learner" />
      </View>
      <View testID="discover">
        <DiscoverScreen />
      </View>
      <View testID="post">
        <PostDetail {...props} />
      </View>
      <View testID="private-post">
        <PostDetail
          {...props}
          socialAvailable={false}
          owner={{ visibility: 'private', controls: () => null }}
        />
      </View>
      <View testID="comments">
        <Comments
          identity={who}
          submissionId={mockPost.id}
          openProfile={jest.fn()}
          unavailable={jest.fn()}
        />
      </View>
      <View testID="search">
        <PeopleResults identity={who} query="lear" />
      </View>
      <View testID="connections">
        <ConnectionsContent identity={who} profileId={id(3)} kind="followers" />
      </View>
      <View testID="public-profile">
        <PublicProfilePanel identity={who} close={jest.fn()} />
      </View>
    </>
  );
}
function expectAvatars(uri?: string) {
  for (const surface of surfaces) {
    const rows = within(screen.getByTestId(surface)).getAllByLabelText("learner's profile photo", {
      includeHiddenElements: true,
    });
    for (const row of rows) {
      if (uri) expect(row).toHaveProp('source', { uri, cache: 'reload' });
      else expect(row).not.toHaveProp('source');
    }
  }
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  AppState.currentState = 'active';
  mockOwn.mockReset().mockResolvedValue({ avatarId: null });
  mockProfile.mockResolvedValue(profile);
  mockSearch.mockResolvedValue({ items: [profile], hasMore: false });
  mockComments.mockResolvedValue({
    items: [
      {
        id: id(4),
        profileId: profile.id,
        username: 'learner',
        avatarId: null,
        isOwn: true,
        body: 'A dog',
        createdAt: mockPost.submittedAt,
      },
    ],
    hasMore: false,
  });
  mockConnections.mockResolvedValue({
    profile: { ...profile, id: id(3), isSelf: false },
    items: [{ ...profile, followedAt: mockPost.submittedAt }],
    hasMore: false,
  });
  mockFeed.mockResolvedValue({ items: [mockPost], hasMore: false });
  mockApi.reserve.mockResolvedValue({ id: id(10), storagePath: 'fixture.jpg', current: false });
  mockApi.upload.mockResolvedValue(undefined);
  mockApi.finalize.mockResolvedValue({ avatarId: id(10) });
  mockApi.remove.mockResolvedValue({ avatarId: null });
  mockPick.mockResolvedValue({ uri: 'data:image/jpeg;base64,/9j/2Q==', bytes: pixels });
  mockPreviews
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, 'https://controlled.test/' + id])),
    );
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(pixels, { headers: { 'content-type': 'image/jpeg' } }),
    );
});
afterEach(() => jest.restoreAllMocks());
it('confirmed save updates every mounted self-avatar from initials, then replaces/removes it without refreshing page metadata', async () => {
  render(
    <>
      <AvatarEditor identity={identity()} username="learner" onChanged={jest.fn()} />
      <Surfaces />
    </>,
  );
  await waitFor(() => expectAvatars());
  const reads = [mockProfile, mockSearch, mockComments, mockConnections, mockFeed].map(
    (mock) => mock.mock.calls.length,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Save photo' }));
  await waitFor(() => expectAvatars('data:image/jpeg;base64,/9j/2Q=='));
  expect(mockOwn).toHaveBeenCalledTimes(1);
  expect(mockPreviews).not.toHaveBeenCalled(); // exact trusted uploaded pixels reused
  const newer = new Uint8Array([255, 216, 255, 1, 255, 217]);
  act(() => avatarChanged(identity(), { avatarId: id(11) }, newer));
  await waitFor(() => expectAvatars('data:image/jpeg;base64,/9j/Af/Z'));
  act(() => avatarChanged(identity(), { avatarId: null }));
  await waitFor(() => expectAvatars());
  expect(
    [mockProfile, mockSearch, mockComments, mockConnections, mockFeed].map(
      (mock) => mock.mock.calls.length,
    ),
  ).toEqual(reads);
});
it('future/cached screens use the receipt even when their retained page still says no avatar', async () => {
  const view = render(<Surfaces />);
  await waitFor(() => expectAvatars());
  view.unmount();
  act(() => avatarChanged(identity(), { avatarId: id(10) }, pixels));
  render(<Surfaces />);
  await waitFor(() => expectAvatars('data:image/jpeg;base64,/9j/2Q=='));
  expect(mockOwn).toHaveBeenCalledTimes(1);
});
it('a late current-pointer read cannot undo a confirmed mutation, and another account never inherits it', async () => {
  let finish = (_: { avatarId: null }) => {};
  mockOwn.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<Surfaces />);
  await waitFor(() => expect(mockOwn).toHaveBeenCalledTimes(1));
  act(() => avatarChanged(identity(), { avatarId: id(10) }, pixels));
  await act(async () => finish({ avatarId: null }));
  await waitFor(() => expectAvatars('data:image/jpeg;base64,/9j/2Q=='));
  view.unmount();
  mockSession = makeSession('another-user');
  render(<Surfaces />);
  await waitFor(() => expectAvatars());
  expect(ownAvatarEntry(identity()).getSnapshot().data).toEqual({ avatarId: null });
});
it('inbox follower avatars batch controlled access; anonymous rating/daily events keep contextual icons', async () => {
  const follower = {
    id: id(8),
    kind: 'NEW_FOLLOWER',
    profileId: id(3),
    username: 'friend',
    avatarId: id(12),
    createdAt: mockPost.submittedAt,
    read: false,
  };
  mockInbox.mockResolvedValue({
    items: [
      follower,
      {
        id: id(9),
        kind: 'NEW_RATING',
        assignmentId: id(1),
        targetTerm: 'dog',
        createdAt: mockPost.submittedAt,
        read: false,
      },
    ],
    hasMore: false,
    unreadCount: 2,
    readCursor: null,
  });
  render(<InboxContent identity={identity()} />);
  await waitFor(() => expect(screen.getByLabelText("friend's profile photo")).toHaveProp('source'));
  expect(mockPreviews).toHaveBeenCalledWith([id(12)], expect.any(AbortSignal));
  mockInbox.mockResolvedValue({
    items: [{ ...follower, avatarId: null }],
    hasMore: false,
    unreadCount: 1,
    readCursor: null,
  });
  act(() =>
    invalidateServerData(['inbox'], { scope: serverScope(identity().userId, identity().token) }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("friend's profile photo")).not.toHaveProp('source'),
  );
});

it.each([true, false])(
  'uses controlled pixels when an upload is already current or finalization returns a different version (current=%s)',
  async (current) => {
    const resultId = current ? id(10) : id(11);
    mockApi.reserve.mockResolvedValue({ id: id(10), storagePath: 'fixture.jpg', current });
    mockApi.finalize.mockResolvedValue({ avatarId: resultId });
    render(<AvatarEditor identity={identity()} username="learner" onChanged={jest.fn()} />);
    await waitFor(() => expect(mockOwn).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Save photo' }));
    await waitFor(() =>
      expect(mockPreviews).toHaveBeenCalledWith([resultId], expect.any(AbortSignal)),
    );
    expect(mockApi.upload).toHaveBeenCalledTimes(current ? 0 : 1);
  },
);
