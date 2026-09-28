import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Button, AppState, Text } from 'react-native';
import { PhotoScreen } from '@/features/photos/photo-screen';
import { PostScreen } from '@/features/discover/post-screen';
import { postScreenOptions } from '@/features/discover/navigation-options';
import { postAcknowledgement } from '@/features/discover/owned-post-access';
import { clearServerData, serverScope } from '@/lib/server-cache';
import { feedback } from '@/lib/haptics';
import { makeAccount, makeSession } from './fixtures';
import {
  photoAssignment,
  photoUser,
  photoFixture,
  preparedPhoto,
  makeSubmission,
} from './photo-fixtures';

const mockScope = serverScope;
const mockAssignment = photoAssignment;
const mockPrepared = preparedPhoto;
let mockFixture = photoFixture();
let mockSession = makeSession(photoUser);
const mockAccount = makeAccount(photoUser);
const mockReceipt = jest.fn(),
  mockPublicRead = jest.fn(),
  mockComments = jest.fn(),
  mockOwnerLookup = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession, account: mockAccount }),
}));
jest.mock('@/features/photos/photo-files', () => ({
  loadDraft: async () => mockPrepared,
  removeDraft: jest.fn(),
}));
jest.mock('@/services/submissions', () => ({
  photoGateway: () => ({
    ...mockFixture.gateway,
    cacheKey: `${mockScope(mockSession.user.id, mockSession.access_token)}:assignment:${mockAssignment}:auto`,
    cachedPreview: () => 'data:image/jpeg;base64,/9j/2Q==',
  }),
}));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: () => ({ load: mockPublicRead }),
}));
jest.mock('@/services/progress', () => ({ receiptGateway: () => mockReceipt }));
jest.mock('@/services/social', () => ({ socialGateway: () => ({ comments: mockComments }) }));
jest.mock('@/features/discover/owned-post-access', () => ({
  ...jest.requireActual('@/features/discover/owned-post-access'),
  loadOwnedPost: (...args: unknown[]) => mockOwnerLookup(...args),
}));
jest.mock('@/lib/haptics', () => ({ feedback: { success: jest.fn(), warning: jest.fn() } }));

function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="post" options={postScreenOptions} />
    </Stack>
  );
}
const routes = {
  _layout: Layout,
  index: () => (
    <Button
      title="Take photo"
      onPress={() => router.push({ pathname: '/photo', params: { assignmentId: photoAssignment } })}
    />
  ),
  photo: PhotoScreen,
  post: PostScreen,
  profile: () => <Text>Profile</Text>,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession(photoUser);
  mockFixture = photoFixture();
  AppState.currentState = 'active';
  mockReceipt.mockResolvedValue({ wordXp: 10, challengeBonusXp: 0, milestoneXp: 0 });
  mockOwnerLookup.mockResolvedValue({ assignmentId: photoAssignment });
  mockComments.mockResolvedValue({ items: [], hasMore: false });
  mockPublicRead.mockResolvedValue({
    items: [
      {
        id: makeSubmission().id,
        targetTerm: 'la fenêtre',
        referenceTerm: 'window',
        cefrLevel: 'A2',
        username: 'learner',
        submittedAt: '2026-09-12T13:00:00Z',
        canRate: false,
        viewerRating: null,
        averageRating: null,
        ratingCount: 0,
      },
    ],
    hasMore: false,
  });
});
async function submit(publicly = false) {
  fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  fireEvent(await screen.findByLabelText('Your challenge photo'), 'load');
  if (publicly) fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
  await screen.findByLabelText('Photo of La fenêtre');
}
it.each([false, true])(
  'replaces capture with the canonical owner post; private/public=%s and Back returns to Today',
  async (publicly) => {
    const app = renderRouter(routes, { initialUrl: '/' });
    await submit(publicly);
    expect(app.getPathname()).toBe('/post');
    expect(app.getSearchParams()).toEqual({ submissionId: makeSubmission().id });
    expect(screen.getByText('La fenêtre')).toBeVisible();
    expect(screen.getByText('Window')).toBeVisible();
    expect(await screen.findByText('Photo added · +10 XP')).toBeVisible();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    if (publicly) {
      expect(await screen.findByText('Your photo')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
      expect(screen.getByText('Comments')).toBeVisible();
      fireEvent.press(screen.getByLabelText('Photo options'));
      expect(screen.getByRole('button', { name: 'Share' })).toBeVisible();
      fireEvent.press(screen.getByLabelText('Close Photo options'));
    } else {
      expect(mockPublicRead).not.toHaveBeenCalled();
      expect(mockComments).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    }
    expect(feedback.success).toHaveBeenCalledTimes(1);
    expect(mockFixture.gateway.finalize).toHaveBeenCalledTimes(1);
    act(() => router.back());
    expect(app.getPathname()).toBe('/');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible();
    act(() => router.push({ pathname: '/post', params: { submissionId: makeSubmission().id } }));
    await screen.findByLabelText('Photo of La fenêtre');
    expect(screen.queryByText(/Photo added/)).toBeNull();
    expect(mockReceipt).toHaveBeenCalledTimes(1);
    expect(feedback.success).toHaveBeenCalledTimes(1);
  },
);
it('opens a restored completed photo without receipt feedback or new writes', async () => {
  mockFixture = photoFixture(
    makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' }),
  );
  const app = renderRouter(routes, { initialUrl: `/photo?assignmentId=${photoAssignment}` });
  await screen.findByLabelText('Photo of La fenêtre');
  expect(app.getPathname()).toBe('/post');
  expect(screen.queryByText(/Photo added/)).toBeNull();
  expect(mockReceipt).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
});
it('reconciles a lost finalize acknowledgement into the post without replaying success or submitting again', async () => {
  const finalize = mockFixture.gateway.finalize.getMockImplementation();
  mockFixture.gateway.finalize.mockImplementationOnce(async (id, visibility) => {
    await finalize?.(id, visibility);
    throw new Error('response lost');
  });
  const app = renderRouter(routes, { initialUrl: '/' });
  await submit();
  expect(app.getPathname()).toBe('/post');
  expect(screen.queryByText(/Photo added/)).toBeNull();
  expect(mockReceipt).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  expect(mockFixture.gateway.upload).toHaveBeenCalledTimes(1);
  expect(mockFixture.gateway.finalize).toHaveBeenCalledTimes(1);
});
it('uses authoritative full-challenge and milestone XP only in the brief acknowledgement', async () => {
  mockReceipt.mockResolvedValue({ wordXp: 10, challengeBonusXp: 10, milestoneXp: 25 });
  renderRouter(routes, { initialUrl: '/' });
  await submit();
  expect(await screen.findByText('Photo added · +45 XP')).toBeVisible();
  expect(screen.queryByText('Daily challenge complete')).toBeNull();
  expect(mockFixture.gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, 'private');
});
it('keeps owner access but hides public controls when moderation or eligibility excludes a public photo', async () => {
  mockPublicRead.mockResolvedValue({ items: [], hasMore: false });
  renderRouter(routes, { initialUrl: '/' });
  await submit(true);
  await waitFor(() => expect(mockPublicRead).toHaveBeenCalled());
  expect(screen.getByLabelText('Photo of La fenêtre')).toBeVisible();
  expect(screen.queryByText('Comments')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
});
it('clears pending acknowledgement capability on logout instead of leaking it into another session', () => {
  const key = postAcknowledgement({ userId: photoUser, token: 'old' }, makeSubmission().id);
  key.set(performance.now() + 10000);
  clearServerData();
  expect(key.getSnapshot().retired).toBe(true);
  expect(
    postAcknowledgement({ userId: photoUser, token: 'new' }, makeSubmission().id).getSnapshot()
      .data,
  ).toBeNull();
});
