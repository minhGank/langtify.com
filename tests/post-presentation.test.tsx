import { PhotoOptions } from '@/features/photos/photo-options';
import { useAssignmentPhoto } from '@/features/photos/use-assignment-photo';
import { photoFixture, makeSubmission } from './photo-fixtures';
import type * as ReactTypes from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react-native';
import {
  Appearance,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Share,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostDetail } from '@/features/discover/post-detail';
import { PostLayout } from '@/features/discover/post-layout';
import { PostAuthor } from '@/features/discover/post-author';
import { CommentComposer } from '@/features/social/comment-composer';
import { SearchEmpty } from '@/features/explore/search-results';
import { AccentBadge } from '@/components/ui/accent-badge';
import { palette } from '@/lib/theme';
import type { FeedItem } from '@/services/discover';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { headerRight: () => ReactTypes.ReactNode } }) =>
      options.headerRight(),
  },
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(effect, [effect]);
  },
}));
const mockComments = jest.fn(async () => ({ items: [], hasMore: false }));
jest.mock('@/services/social', () => ({ socialGateway: () => ({ comments: mockComments }) }));
jest.mock('@/features/social/public-profile', () => ({ PublicProfileSheet: () => null }));
jest.mock('@/services/safety', () => ({ safetyGateway: () => ({}) }));

const item: FeedItem = {
  id: '77000000-0000-4000-8000-000000000001',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  avatarId: null,
  username: 'learner',
  submittedAt: '2026-09-26T12:00:00Z',
  canRate: true,
  viewerRating: null,
  averageRating: null,
  ratingCount: 0,
};
const props = {
  item,
  userId: 'viewer',
  token: 'token',
  language: 'French',
  photoRevision: 0,
  uri: 'data:image/jpeg;base64,cGl4ZWxz',
  reload: jest.fn(),
  rate: jest.fn(),
  ratingAction: null,
  ratingDisabled: false,
  blocked: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
});

it('keeps the full conversation inside scrolling content and the composer outside it', async () => {
  render(<PostDetail {...props} />);
  await screen.findByText('No comments yet.');
  const scroll = screen.UNSAFE_getByType(ScrollView);
  expect(within(scroll).getByText('Comments')).toBeVisible();
  expect(within(scroll).getByLabelText('Photo of Le chien')).toBeVisible();
  expect(within(scroll).queryByLabelText('Add a comment')).toBeNull();
  expect(screen.getByLabelText('Add a comment')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Send comment' })).toBeDisabled();
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(screen.getByLabelText('Rate how well the photo represents Le chien')).toHaveProp(
    'accessibilityRole',
    'radiogroup',
  );
});

it('keeps safe sharing and report/block inside overflow instead of the conversation', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  render(<PostDetail {...props} />);
  await screen.findByText('Comments');
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Report photo' })).toBeNull();
  fireEvent.press(screen.getByLabelText('More actions for @learner'));
  expect(screen.getByRole('button', { name: 'Report photo' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Block user' })).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  await act(async () => {});
  expect(share).toHaveBeenCalledWith({
    title: 'le chien · Langtify',
    message: expect.stringContaining('https://langtify.com'),
  });
  expect(JSON.stringify(share.mock.calls)).not.toMatch(/base64|token|storage|submissionId/);
  share.mockRestore();
});

it('keeps private owner content free of composer, public reads and share actions', async () => {
  render(
    <PostDetail
      {...props}
      item={{ ...item, canRate: false }}
      socialAvailable={false}
      owner={{ visibility: 'private', controls: () => null }}
    />,
  );
  await act(async () => {});
  expect(screen.getByLabelText('Photo of Le chien')).toBeVisible();
  expect(mockComments).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Add a comment')).toBeNull();
  expect(screen.queryByLabelText('Rate photo: Le chien')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
});

it('uses a recognizable author identity without per-row requests or sentence labels', () => {
  const open = jest.fn();
  render(<PostAuthor username="learner" onPress={open} />);
  expect(screen.getByText('@learner')).toBeVisible();
  expect(screen.getByText('L', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText(/Photo by/)).toBeNull();
  fireEvent.press(screen.getByLabelText('View @learner'));
  expect(open).toHaveBeenCalledTimes(1);
});

it('preserves native multiline entry, accessible send/retry state and a bounded composer', () => {
  const send = jest.fn(),
    change = jest.fn();
  const view = render(
    <CommentComposer
      value="   "
      change={change}
      send={send}
      busy={false}
      retry={false}
      error={null}
    />,
  );
  expect(screen.getByRole('button', { name: 'Send comment' })).toBeDisabled();
  view.rerender(
    <CommentComposer
      value="A clear example"
      change={change}
      send={send}
      busy
      retry={false}
      error={null}
    />,
  );
  expect(screen.getByRole('button', { name: 'Sending comment' })).toBeDisabled();
  expect(screen.getByLabelText('Add a comment')).toHaveProp('editable', false);
  view.rerender(
    <CommentComposer
      value="A clear example"
      change={change}
      send={send}
      busy={false}
      retry
      error="We couldn’t confirm your comment."
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t confirm your comment.');
  fireEvent.press(screen.getByRole('button', { name: 'Retry comment' }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Add a comment')).toHaveProp('submitBehavior', 'newline');
  expect(screen.getByLabelText('Add a comment')).toHaveStyle({ maxHeight: 144 });
});

it('keeps one keyboard avoidance owner and removes home-indicator padding above the keyboard', () => {
  const listener = jest.spyOn(Keyboard, 'addListener');
  render(
    <PostLayout composer={<Text>Composer</Text>}>
      <Text>Thread</Text>
    </PostLayout>,
  );
  expect(screen.UNSAFE_getAllByType(KeyboardAvoidingView)).toHaveLength(1);
  expect(screen.UNSAFE_getByType(ScrollView).props.automaticallyAdjustKeyboardInsets).not.toBe(
    true,
  );
  const show = listener.mock.calls.find(([event]) => event === 'keyboardDidShow')?.[1];
  const hide = listener.mock.calls.find(([event]) => event === 'keyboardDidHide')?.[1];
  const event = {
    duration: 0,
    easing: 'keyboard' as const,
    endCoordinates: { screenX: 0, screenY: 400, width: 390, height: 300 },
  };
  act(() => show?.(event));
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['left', 'right']);
  act(() => hide?.(event));
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['left', 'right', 'bottom']);
  listener.mockRestore();
});

it.each(['light', 'dark'] as const)('uses restrained semantic surfaces in %s mode', (mode) => {
  const scheme = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(mode);
  const colors = palette[mode];
  render(
    <>
      <SearchEmpty title="Find a word" />
      <AccentBadge tone="energy" icon="flame" label="7 day streak" />
      <AccentBadge tone="reward" icon="sparkles-outline" label="+10 XP" />
    </>,
  );
  const icons = screen.UNSAFE_getAllByType(Ionicons);
  expect(icons.find((node) => node.props.name === 'search-outline')?.props.color).toBe(
    colors.textSecondary,
  );
  expect(screen.getByText('7 day streak')).toHaveStyle({ color: colors.textPrimary });
  expect(screen.getByText('+10 XP')).toHaveStyle({ color: colors.textPrimary });
  scheme.mockRestore();
});

it.each(['private', 'public'] as const)(
  'uses the same overflow trigger for an owner %s photo and another author',
  async (visibility) => {
    const fixture = photoFixture(makeSubmission({ status: 'completed', visibility }));
    function OwnerOptions() {
      const state = useAssignmentPhoto(fixture.gateway, fixture.drafts);
      return <PhotoOptions state={state} />;
    }
    render(
      <>
        <OwnerOptions />
        <PostDetail {...props} />
      </>,
    );
    const owner = screen.getByRole('button', { name: 'Photo options' });
    const other = screen.getByRole('button', { name: 'More actions for @learner' });
    await waitFor(() => expect(owner).not.toBeDisabled());
    expect(owner.props.style).toEqual(other.props.style);
    expect(owner).toHaveStyle({
      minWidth: 48,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: 'transparent',
    });
    fireEvent.press(owner);
    expect(await screen.findByText('Delete photo')).toBeVisible();
    expect(screen.queryByText('Report photo')).toBeNull();
  },
);
