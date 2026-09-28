import { act, cleanup, render, screen } from '@testing-library/react-native';
import { ActivityIndicator, Animated, Appearance, AppState, Text, View } from 'react-native';
import SessionScreen from '../app/session';
import { PreparationState } from '@/components/ui/preparation-state';
import { languageFacts, selectLanguageFact } from '@/data/language-facts';
import { palette } from '@/lib/theme';

let mockReduced = true;
let mockStatus = 'loading';
const initialAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: mockStatus, reload: jest.fn() }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = true;
  mockStatus = 'loading';
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (initialAppState) Object.defineProperty(AppState, 'currentState', initialAppState);
});

it('maps a reproducible sample to every curated fact and safely handles invalid samples', () => {
  languageFacts.forEach((fact, index) => {
    expect(selectLanguageFact((index + 0.5) / languageFacts.length)).toBe(fact);
  });
  expect(selectLanguageFact(0)).toBe(languageFacts[0]);
  expect(selectLanguageFact(0.999999)).toBe(languageFacts.at(-1));
  for (const invalid of [-1, 1, Infinity, NaN]) {
    expect(selectLanguageFact(invalid)).toBe(languageFacts[0]);
  }
});

it('reveals one fact only after a longer wait and keeps it stable across renders and time', () => {
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const view = render(<PreparationState title="Preparing" label="Loading account" />);
  expect(screen.getByRole('progressbar', { name: 'Loading account' })).toBeBusy();
  expect(screen.queryByText(languageFacts[0].text)).toBeNull();
  act(() => jest.advanceTimersByTime(1499));
  expect(screen.queryByText('While you wait')).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.getByText(languageFacts[0].text)).toBeVisible();
  random.mockReturnValue(0.9);
  view.rerender(<PreparationState title="Still preparing" label="Loading account" />);
  act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByText(languageFacts[0].text)).toBeVisible();
  expect(random).toHaveBeenCalledTimes(1);
});

it('reserves the chosen text before reveal without exposing hidden copy to VoiceOver', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  render(<PreparationState title="Preparing" label="Loading account" />);
  const reserved = screen.getByText(languageFacts[0].text, { includeHiddenElements: true });
  expect(reserved).not.toBeVisible();
  expect(reserved.props.numberOfLines).toBeUndefined();
  expect(reserved.props.allowFontScaling).not.toBe(false);
  expect(reserved.props.maxFontSizeMultiplier).toBeUndefined();
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByText(languageFacts[0].text)).toBe(reserved);
  expect(reserved).toBeVisible();
});

it('cancels a quick wait without delaying completion and selects anew for a later loading session', () => {
  const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999);
  const view = render(
    <View>
      <PreparationState title="Preparing" label="Loading account" />
    </View>,
  );
  view.rerender(
    <View>
      <Text>Ready</Text>
    </View>,
  );
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByText('Ready')).toBeVisible();
  expect(screen.queryByText('While you wait')).toBeNull();
  view.rerender(
    <View>
      <PreparationState title="Preparing" label="Loading account" />
    </View>,
  );
  expect(screen.queryByText('While you wait')).toBeNull();
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByText(selectLanguageFact(0.999).text)).toBeVisible();
  expect(random).toHaveBeenCalledTimes(2);
});

it('keeps loading and facts readable in both themes without a spinner or entrance under Reduce Motion', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const timing = jest.spyOn(Animated, 'timing');
  const appearance = jest.spyOn(Appearance, 'getColorScheme');
  for (const scheme of ['light', 'dark'] as const) {
    appearance.mockReturnValue(scheme);
    const view = render(<PreparationState title="Preparing" label="Loading account" />);
    act(() => jest.advanceTimersByTime(1500));
    expect(screen.getByText('Preparing')).toHaveStyle({
      color: palette[scheme].textPrimary,
      textAlign: 'center',
    });
    expect(screen.getByText(languageFacts[0].text)).toHaveStyle({
      color: palette[scheme].textSecondary,
      textAlign: 'center',
    });
    expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    view.unmount();
  }
});

it('uses one restrained fact entrance and removes motion when the preference changes', () => {
  mockReduced = false;
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue(animation);
  const view = render(<PreparationState title="Preparing" label="Loading account" />);
  expect(view.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(timing).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1500));
  expect(timing).toHaveBeenCalledTimes(1);
  mockReduced = true;
  view.rerender(<PreparationState title="Preparing" label="Loading account" />);
  expect(animation.stop).toHaveBeenCalled();
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.getByText('While you wait')).toBeVisible();
});

it('removes account preparation and its fact on failure, leaving explicit recovery controls', () => {
  const view = render(<SessionScreen />);
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByText('While you wait')).toBeVisible();
  mockStatus = 'error';
  view.rerender(<SessionScreen />);
  expect(screen.queryByText('While you wait')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
