import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, AppState, Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { MotionView } from '@/components/ui/motion-view';
import { Sheet } from '@/components/ui/sheet';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { feedback } from '@/lib/haptics';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  performAndroidHapticsAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  AndroidHaptics: {
    Segment_Tick: 'tick',
    Virtual_Key: 'key',
    Confirm: 'confirm',
    Reject: 'reject',
  },
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const initialAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (initialAppState) Object.defineProperty(AppState, 'currentState', initialAppState);
});

function Preference({ label }: { label: string }) {
  const reduced = useReducedMotion();
  return (
    <Text>
      {label}: {reduced ? 'reduced' : 'full'}
    </Text>
  );
}

function accessibility(initial: Promise<boolean> = Promise.resolve(false)) {
  let change: (value: boolean) => void = () => {};
  const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', () => {});
  const remove = jest.spyOn(subscription, 'remove');
  const subscribe = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((name: string, listener: unknown) => {
      if (name === 'reduceMotionChanged' && typeof listener === 'function')
        change = (value) => listener(value);
      return subscription;
    });
  subscribe.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial);
  return { emit: (value: boolean) => change(value), subscribe, remove };
}

it('shares one preference subscription and ignores an initial answer older than an OS change', async () => {
  let answer: (value: boolean) => void = () => {};
  const os = accessibility(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const view = render(
    <View>
      <Preference label="one" />
      <Preference label="two" />
    </View>,
  );
  expect(screen.getByText('one: reduced')).toBeVisible();
  expect(os.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => {
    os.emit(true);
    answer(false);
  });
  expect(screen.getByText('two: reduced')).toBeVisible();
  act(() => os.emit(false));
  expect(screen.getByText('one: full')).toBeVisible();
  view.unmount();
  expect(os.remove).toHaveBeenCalledTimes(1);
});

it('stays reduced if preference lookup fails', async () => {
  accessibility(Promise.reject(new Error('unavailable')));
  render(<Preference label="motion" />);
  await act(async () => {});
  expect(screen.getByText('motion: reduced')).toBeVisible();
});

it('animates a deliberate change only, stops on reduce-motion changes and never hides the content', async () => {
  const os = accessibility();
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue(animation);
  const view = render(
    <MotionView trigger={0} kind="step">
      <Text>Choose a language</Text>
    </MotionView>,
  );
  await act(async () => {});
  expect(timing).not.toHaveBeenCalled();
  view.rerender(
    <MotionView trigger={1} kind="step">
      <Text>Your level</Text>
    </MotionView>,
  );
  expect(timing).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ useNativeDriver: true, isInteraction: false }),
  );
  expect(screen.getByText('Your level')).toBeVisible();
  act(() => os.emit(true));
  expect(animation.stop).toHaveBeenCalled();
  timing.mockClear();
  view.rerender(
    <MotionView trigger={2} kind="step">
      <Text>Your username</Text>
    </MotionView>,
  );
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByText('Your username')).toBeVisible();
});

it('finishes visible when an in-flight reward backgrounds and never replays on resume', async () => {
  accessibility();
  let state: (value: 'active' | 'background') => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    state = listener;
    return { remove: jest.fn() };
  });
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue(animation);
  const view = render(
    <MotionView trigger={null} kind="reward">
      <Text>Complete</Text>
    </MotionView>,
  );
  await act(async () => {});
  view.rerender(
    <MotionView trigger="receipt" kind="reward">
      <Text>Complete</Text>
    </MotionView>,
  );
  expect(spring).toHaveBeenCalledTimes(1);
  act(() => state('background'));
  act(() => state('active'));
  expect(animation.stop).toHaveBeenCalled();
  expect(spring).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Complete')).toBeVisible();
});

it('does not truncate an admitted entrance on an unrelated parent render', async () => {
  const os = accessibility();
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue(animation);
  const content = (enter: boolean) => (
    <View>
      <Preference label="motion" />
      <MotionView trigger="receipt" kind="reward" animateOnMount={enter}>
        <Text>Reward</Text>
      </MotionView>
    </View>
  );
  const view = render(
    <View>
      <Preference label="motion" />
    </View>,
  );
  await act(async () => {});
  view.rerender(content(true));
  expect(spring).toHaveBeenCalledTimes(1);
  view.rerender(content(false));
  expect(animation.stop).not.toHaveBeenCalled();
  expect(spring).toHaveBeenCalledTimes(1);
  act(() => os.emit(true));
  expect(animation.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Reward')).toBeVisible();
});

it('releases a pressed button if backgrounding interrupts the press-out event', async () => {
  accessibility();
  let state: (value: 'active' | 'background') => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    state = listener;
    return { remove: jest.fn() };
  });
  const timing = jest.spyOn(Animated, 'timing');
  render(<Button label="Continue" onPress={jest.fn()} />);
  await act(async () => {});
  fireEvent(screen.getByRole('button', { name: 'Continue' }), 'pressIn');
  const scale = timing.mock.calls[0][0];
  const reset = jest.spyOn(scale, 'setValue');
  act(() => state('background'));
  expect(reset).toHaveBeenCalledWith(1);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

it('keeps routine button navigation silent and busy buttons unavailable during press feedback', async () => {
  accessibility();
  const press = jest.fn();
  const view = render(<Button label="Open profile" onPress={press} />);
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Open profile' }));
  expect(press).toHaveBeenCalledTimes(1);
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  view.rerender(<Button label="Open profile" onPress={press} loading />);
  fireEvent.press(screen.getByRole('button'));
  expect(press).toHaveBeenCalledTimes(1);
});

it('keeps unchanged or disabled choices silent and emits one tick for a changed choice', () => {
  const change = jest.fn();
  render(
    <ChoiceField
      label="Level"
      value="A1"
      onChange={change}
      options={[
        { value: 'A1', label: 'A1' },
        { value: 'A2', label: 'A2' },
      ]}
    />,
  );
  fireEvent.press(screen.getByRole('radio', { name: 'A1' }));
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('radio', { name: 'A2' }));
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith('A2');
});

it('uses iOS selection, light confirmation and distinct success/warning feedback', () => {
  feedback.selection();
  feedback.confirm();
  feedback.success();
  feedback.warning();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(
    1,
    Haptics.NotificationFeedbackType.Success,
  );
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(
    2,
    Haptics.NotificationFeedbackType.Warning,
  );
});

it('uses Android system haptics rather than vibration patterns', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  feedback.selection();
  feedback.confirm();
  feedback.success();
  feedback.warning();
  expect(jest.mocked(Haptics.performAndroidHapticsAsync).mock.calls).toEqual([
    ['tick'],
    ['key'],
    ['confirm'],
    ['reject'],
  ]);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

it('ignores unsupported hardware and never vibrates on web or in the background', async () => {
  jest.mocked(Haptics.selectionAsync).mockRejectedValueOnce(new Error('missing native module'));
  expect(() => feedback.selection()).not.toThrow();
  await act(async () => {});
  jest.mocked(Haptics.selectionAsync).mockClear();
  jest.replaceProperty(AppState, 'currentState', 'background');
  feedback.selection();
  jest.replaceProperty(AppState, 'currentState', 'active');
  jest.replaceProperty(Platform, 'OS', 'web');
  feedback.selection();
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
});

it('keeps sheet controls accessible with motion disabled', async () => {
  accessibility(Promise.resolve(true));
  const close = jest.fn();
  render(
    <Sheet title="Choose level" visible onClose={close}>
      <Text>Options</Text>
    </Sheet>,
  );
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Close Choose level' }));
  expect(close).toHaveBeenCalledTimes(1);
});
