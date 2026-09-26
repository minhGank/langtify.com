import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Share } from 'react-native';
import { PublicProfilePanel } from '@/features/social/public-profile';
import { Comments } from '@/features/social/comments';
import { EditProfileScreen } from '@/features/profile/edit-profile-screen';
import { PeopleScreen } from '@/features/social/people-screen';
import { sharePost } from '@/features/discover/share-post';
import { parseComment, parsePublicProfile } from '@/services/social';
import { SafetyUnavailable } from '@/features/safety/model';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { profileCache } from '@/features/social/cache';
import { makeAccount, makeSession } from './fixtures';
import { feedback } from '@/lib/haptics';
jest.mock('@/lib/haptics', () => ({
  feedback: { confirm: jest.fn(), success: jest.fn() },
}));

const mockGateway = {
  profile: jest.fn(),
  follow: jest.fn(),
  block: jest.fn(),
  search: jest.fn(),
  comments: jest.fn(),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  reportComment: jest.fn(),
  updateUsername: jest.fn(),
};
const mockReload = jest.fn();
let mockSession = makeSession();
const mockAccount = makeAccount();
jest.mock('@/services/social', () => ({
  ...jest.requireActual('@/services/social'),
  socialGateway: () => mockGateway,
}));
jest.mock('@/features/profile/avatar-editor', () => ({ AvatarEditor: () => null }));
jest.mock('@/features/profile/profile-avatar', () => ({ ProfileAvatar: () => null }));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => ({ previews: jest.fn() }) }));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    status: 'ready',
    session: mockSession,
    account: mockAccount,
    reload: mockReload,
    refreshAccount: mockReload,
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '79000000-0000-4000-8000-000000000099' }));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const identity = { userId: 'viewer', token: 'token' };
const id = '79000000-0000-4000-8000-000000000001';
const profile = {
  id,
  username: 'learner',
  isSelf: false,
  isFollowing: false,
  followerCount: 2,
  followingCount: 1,
  avatarId: null,
};
const comment = {
  id,
  body: 'A clear example!',
  username: 'learner',
  profileId: id,
  createdAt: '2026-09-21T12:00:00Z',
  isOwn: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockGateway)) fn.mockReset();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockSession = makeSession();
  mockGateway.profile.mockResolvedValue(profile);
  mockGateway.comments.mockResolvedValue({ items: [comment], hasMore: false });
  mockGateway.search.mockResolvedValue({ items: [profile], hasMore: false });
  mockGateway.follow.mockResolvedValue({
    profile: { ...profile, isFollowing: true, followerCount: 3 },
    viewerProfile: {
      ...profile,
      id: '79000000-0000-4000-8000-000000000002',
      isSelf: true,
      followingCount: 2,
    },
    followedAt: '2026-09-22T12:00:00Z',
  });
  mockGateway.block.mockResolvedValue(undefined);
  mockGateway.createComment.mockResolvedValue(undefined);
  mockGateway.deleteComment.mockResolvedValue(undefined);
  mockGateway.reportComment.mockResolvedValue(undefined);
  mockGateway.updateUsername.mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());

it('uses authoritative follow state and shares a fresh public profile cache on revisit', async () => {
  const target = { profileId: id };
  const first = render(
    <PublicProfilePanel identity={identity} target={target} close={jest.fn()} />,
  );
  fireEvent.press(await screen.findByText('Follow'));
  await waitFor(() =>
    expect(mockGateway.follow).toHaveBeenCalledWith(id, true, expect.any(AbortSignal)),
  );
  await screen.findByText('Unfollow');
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
  expect(mockGateway.profile).toHaveBeenCalledTimes(1);
  first.unmount();
  render(<PublicProfilePanel identity={identity} target={target} close={jest.fn()} />);
  await screen.findByText('@learner');
  expect(mockGateway.profile).toHaveBeenCalledTimes(1);
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
});
it('confirms follow and unfollow only after their accepted responses and serializes rapid taps', async () => {
  let finish = (_: unknown) => {};
  mockGateway.follow.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<PublicProfilePanel identity={identity} target={{ profileId: id }} close={jest.fn()} />);
  fireEvent.press(await screen.findByText('Follow'));
  fireEvent.press(screen.getByText('Follow'));
  expect(mockGateway.follow).toHaveBeenCalledTimes(1);
  expect(feedback.confirm).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      profile: { ...profile, isFollowing: true, followerCount: 3 },
      viewerProfile: { ...profile, id: '79000000-0000-4000-8000-000000000002', isSelf: true },
      followedAt: '2026-09-22T12:00:00Z',
    }),
  );
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
  mockGateway.follow.mockResolvedValueOnce({
    profile,
    viewerProfile: { ...profile, id: '79000000-0000-4000-8000-000000000002', isSelf: true },
    followedAt: null,
  });
  fireEvent.press(screen.getByText('Unfollow'));
  await screen.findByText('Follow');
  expect(mockGateway.follow).toHaveBeenLastCalledWith(id, false, expect.any(AbortSignal));
  expect(feedback.confirm).toHaveBeenCalledTimes(2);
});
it('does not offer self-follow and confirms a block', async () => {
  mockGateway.profile.mockResolvedValueOnce({ ...profile, isSelf: true });
  const view = render(<PublicProfilePanel identity={identity} close={jest.fn()} />);
  await screen.findByText('@learner');
  expect(screen.queryByText('Follow')).toBeNull();
  view.unmount();
  const close = jest.fn();
  render(<PublicProfilePanel identity={identity} target={{ profileId: id }} close={close} />);
  fireEvent.press(await screen.findByText('Block account'));
  expect(mockGateway.block).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Confirm block'));
  await waitFor(() => expect(mockGateway.block).toHaveBeenCalledWith(id, expect.any(AbortSignal)));
  expect(close).toHaveBeenCalled();
});
it.each(['profile', 'viewerProfile'])(
  'does not acknowledge follow when %s eligibility disappeared',
  async (missing) => {
    mockGateway.follow.mockResolvedValueOnce({
      profile: missing === 'profile' ? null : { ...profile, isFollowing: true },
      viewerProfile: missing === 'viewerProfile' ? null : { ...profile, isSelf: true },
      followedAt: '2026-09-22T12:00:00Z',
    });
    render(<PublicProfilePanel identity={identity} target={{ profileId: id }} close={jest.fn()} />);
    fireEvent.press(await screen.findByText('Follow'));
    await act(async () => {});
    expect(mockGateway.follow).toHaveBeenCalledTimes(1);
    expect(feedback.confirm).not.toHaveBeenCalled();
  },
);
it('does not reopen a cached public profile after the server rejects its eligibility', async () => {
  const related = createServerCache<string>().entry(
    `${serverScope(identity.userId, identity.token)}:related`,
    ['user-search'],
  );
  related.set('previously visible username');
  const target = { profileId: id };
  const view = render(<PublicProfilePanel identity={identity} target={target} close={jest.fn()} />);
  await screen.findByText('@learner');
  mockGateway.follow.mockRejectedValueOnce(new SafetyUnavailable('Profile unavailable.'));
  mockGateway.profile.mockRejectedValue(new SafetyUnavailable('Profile unavailable.'));
  fireEvent.press(screen.getByText('Follow'));
  await screen.findByText('Profile unavailable.');
  expect(feedback.confirm).not.toHaveBeenCalled();
  expect(related.getSnapshot().data).toBeNull();
  view.unmount();
  render(<PublicProfilePanel identity={identity} target={target} close={jest.fn()} />);
  await act(async () => {});
  expect(screen.queryByText('@learner')).toBeNull();
});
it('clears public caches and leaves the post after comment eligibility is denied', async () => {
  const related = createServerCache<string>().entry(
    `${serverScope(identity.userId, identity.token)}:public-content`,
    ['discover'],
  );
  related.set('previously visible post');
  const unavailable = jest.fn();
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={unavailable}
    />,
  );
  await screen.findByText('A clear example!');
  mockGateway.createComment.mockRejectedValueOnce(new SafetyUnavailable('Post unavailable.'));
  mockGateway.comments.mockRejectedValue(new SafetyUnavailable('Post unavailable.'));
  fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Comment');
  fireEvent.press(screen.getByText('Post comment'));
  await screen.findByText('Post unavailable.');
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(related.getSnapshot().data).toBeNull();
  expect(screen.queryByText('A clear example!')).toBeNull();
});
it('clears alternate profile lookups after a denied read without automatically retrying', async () => {
  const alternate = profileCache.entry(
    `${serverScope(identity.userId, identity.token)}:profile:post:${id}`,
    ['public-profile'],
  );
  alternate.set(profile);
  mockGateway.profile.mockRejectedValue(new SafetyUnavailable('Profile unavailable.'));
  const view = render(
    <PublicProfilePanel identity={identity} target={{ profileId: id }} close={jest.fn()} />,
  );
  await screen.findByText('We couldn’t load this profile. Try again.');
  expect(alternate.getSnapshot().data).toBeNull();
  expect(mockGateway.profile).toHaveBeenCalledTimes(1);
  view.unmount();
  render(
    <PublicProfilePanel identity={identity} target={{ submissionId: id }} close={jest.fn()} />,
  );
  await screen.findByText('We couldn’t load this profile. Try again.');
  expect(mockGateway.profile).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('@learner')).toBeNull();
});
it('retries uncertain comment creation using the same durable request ID and prevents duplicate taps', async () => {
  mockGateway.createComment.mockRejectedValueOnce(new Error('lost response'));
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  await screen.findByText('A clear example!');
  fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Thoughtful comment');
  fireEvent.press(screen.getByText('Post comment'));
  fireEvent.press(await screen.findByText('Retry comment'));
  await waitFor(() => expect(mockGateway.createComment).toHaveBeenCalledTimes(2));
  expect(mockGateway.createComment.mock.calls[0].slice(0, 3)).toEqual(
    mockGateway.createComment.mock.calls[1].slice(0, 3),
  );
  await waitFor(() => expect(screen.getByLabelText('Add a comment')).toHaveProp('value', ''));
  expect(screen.getByText('Comment posted.')).toBeVisible();
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
});
it('deletes only through confirmed owner actions and reloads comments', async () => {
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  fireEvent.press(await screen.findByLabelText('Options for comment by @learner'));
  fireEvent.press(screen.getByText('Delete comment'));
  expect(mockGateway.deleteComment).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Confirm delete comment'));
  await waitFor(() =>
    expect(mockGateway.deleteComment).toHaveBeenCalledWith(id, expect.any(AbortSignal)),
  );
  await waitFor(() => expect(mockGateway.comments).toHaveBeenCalledTimes(2));
});
it('offers private reporting and blocking for someone else’s comment', async () => {
  mockGateway.comments.mockResolvedValue({ items: [{ ...comment, isOwn: false }], hasMore: false });
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  fireEvent.press(await screen.findByLabelText('Options for comment by @learner'));
  expect(screen.queryByText('Delete comment')).toBeNull();
  fireEvent.press(screen.getByText('Report comment'));
  fireEvent.press(screen.getByText('Submit report'));
  await screen.findByText('Thanks for letting us know.');
  expect(mockGateway.reportComment).toHaveBeenCalledWith(
    id,
    'harassment_hate',
    '',
    expect.any(AbortSignal),
  );
});
it('validates and saves username without sending unrelated learning preferences', async () => {
  render(<EditProfileScreen />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'x');
  fireEvent.press(screen.getByText('Save username'));
  expect(mockGateway.updateUsername).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Username'), 'New_Name');
  fireEvent.press(screen.getByText('Save username'));
  await waitFor(() =>
    expect(mockGateway.updateUsername).toHaveBeenCalledWith('new_name', expect.any(AbortSignal)),
  );
  expect(mockReload).toHaveBeenCalled();
  expect(feedback.success).toHaveBeenCalledTimes(1);
});
it('keeps a rejected username editable and shows the safe error', async () => {
  mockGateway.updateUsername.mockRejectedValue(new Error('That username is already taken.'));
  render(<EditProfileScreen />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'someone');
  fireEvent.press(screen.getByText('Save username'));
  await screen.findByText('That username is taken. Try another.');
  expect(mockReload).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
});
it('discards a username response after an account switch', async () => {
  let finish = () => {};
  mockGateway.updateUsername.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<EditProfileScreen />);
  fireEvent.changeText(screen.getByLabelText('Username'), 'newname');
  fireEvent.press(screen.getByText('Save username'));
  await waitFor(() => expect(mockGateway.updateUsername).toHaveBeenCalled());
  const signal: AbortSignal = mockGateway.updateUsername.mock.calls[0][1];
  mockSession = makeSession('another-account');
  view.rerender(<EditProfileScreen />);
  await act(async () => finish());
  expect(signal.aborted).toBe(true);
  expect(mockReload).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
});
it('debounces bounded prefix search and rejects broad wildcard input', async () => {
  jest.useFakeTimers();
  render(<PeopleScreen />);
  fireEvent.changeText(screen.getByLabelText('Search usernames'), '%');
  await act(async () => jest.advanceTimersByTime(350));
  expect(mockGateway.search).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Search usernames'), 'Lea');
  await act(async () => jest.advanceTimersByTime(350));
  expect(mockGateway.search).toHaveBeenCalledWith('lea', null, expect.any(AbortSignal));
  expect(screen.getByText('@learner')).toBeVisible();
});
it('shares vocabulary context without bearer URLs or unsupported post links', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  await sharePost({ targetTerm: 'le chien', referenceTerm: 'dog', username: 'learner' });
  expect(share).toHaveBeenCalledWith({
    title: 'le chien · Langtify',
    message: 'le chien — dog\nA word in photos by @learner on Langtify.\nhttps://langtify.com',
  });
});
it('validates public profiles and comments without accepting malformed counts or hidden identity fields', () => {
  expect(() =>
    parsePublicProfile({
      id,
      username: 'learner',
      is_self: false,
      is_following: false,
      follower_count: -1,
      following_count: 0,
    }),
  ).toThrow();
  expect(() =>
    parseComment({
      id,
      body: 'x'.repeat(501),
      username: 'learner',
      profile_id: id,
      created_at: comment.createdAt,
      is_own: false,
    }),
  ).toThrow();
});

it('reconciles a public-profile follow whose acknowledgement was interrupted by navigation', async () => {
  let finish = (_: unknown) => {};
  mockGateway.follow.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const target = { profileId: id };
  const first = render(
    <PublicProfilePanel identity={identity} target={target} close={jest.fn()} />,
  );
  fireEvent.press(await screen.findByText('Follow'));
  await waitFor(() => expect(mockGateway.follow).toHaveBeenCalledTimes(1));
  first.unmount();
  mockGateway.profile.mockResolvedValue({ ...profile, isFollowing: true, followerCount: 3 });
  render(<PublicProfilePanel identity={identity} target={target} close={jest.fn()} />);
  await screen.findByText('Unfollow');
  expect(mockGateway.profile).toHaveBeenCalledTimes(2);
  await act(async () =>
    finish({
      profile: { ...profile, isFollowing: true },
      viewerProfile: { ...profile, id: '79000000-0000-4000-8000-000000000002', isSelf: true },
      followedAt: '2026-09-22T12:00:00Z',
    }),
  );
  expect(screen.getByText('Unfollow')).toBeVisible();
  expect(mockGateway.follow).toHaveBeenCalledTimes(1);
  expect(feedback.confirm).not.toHaveBeenCalled();
});

it('keeps comments visible while a successful new comment reconciles without a reload control', async () => {
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  await screen.findByText('A clear example!');
  expect(screen.queryByLabelText('Refresh comments')).toBeNull();
  let finish = (_: unknown) => {};
  mockGateway.comments.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Another clear example');
  fireEvent.press(screen.getByText('Post comment'));
  await waitFor(() => expect(mockGateway.comments).toHaveBeenCalledTimes(2));
  expect(screen.getByText('A clear example!')).toBeVisible();
  await act(async () =>
    finish({
      items: [
        { ...comment, id: '79000000-0000-4000-8000-000000000003', body: 'Another clear example' },
        comment,
      ],
      hasMore: false,
    }),
  );
  expect(screen.getByText('Another clear example')).toBeVisible();
  expect(screen.getByText('A clear example!')).toBeVisible();
});

it('does not acknowledge a comment response after its screen is no longer active', async () => {
  let finish = () => {};
  mockGateway.createComment.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  await screen.findByText('A clear example!');
  fireEvent.changeText(screen.getByLabelText('Add a comment'), 'A comment');
  fireEvent.press(screen.getByText('Post comment'));
  await waitFor(() => expect(mockGateway.createComment).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish());
  expect(feedback.confirm).not.toHaveBeenCalled();
});

it('removes a confirmed deletion locally while retaining the rest of the loaded conversation', async () => {
  const surviving = {
    ...comment,
    id: '79000000-0000-4000-8000-000000000003',
    username: 'another',
    body: 'Keep this comment',
    isOwn: false,
  };
  mockGateway.comments.mockResolvedValueOnce({ items: [comment, surviving], hasMore: false });
  render(
    <Comments
      identity={identity}
      submissionId={id}
      openProfile={jest.fn()}
      unavailable={jest.fn()}
    />,
  );
  await screen.findByText('Keep this comment');
  let finish = (_: unknown) => {};
  mockGateway.comments.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.press(screen.getByLabelText('Options for comment by @learner'));
  fireEvent.press(screen.getByText('Delete comment'));
  fireEvent.press(screen.getByText('Confirm delete comment'));
  await waitFor(() => expect(mockGateway.comments).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('A clear example!')).toBeNull();
  expect(screen.getByText('Keep this comment')).toBeVisible();
  expect(screen.getByText('Comment deleted.')).toBeVisible();
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
  await act(async () => finish({ items: [surviving], hasMore: false }));
  expect(screen.queryByText('A clear example!')).toBeNull();
});
