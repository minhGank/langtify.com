import { act, render, screen } from '@testing-library/react-native';
import { Appearance, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { palette } from '@/lib/theme';

function Card() {
  const { colors } = useAppTheme();
  return (
    <View testID="card" style={{ backgroundColor: colors.surface }}>
      <AppText testID="card-label">Learning progress</AppText>
    </View>
  );
}

function Page({ title }: { title: string }) {
  const { colors } = useAppTheme();
  return (
    <View testID="page" style={{ backgroundColor: colors.background }}>
      <AppText>{title}</AppText>
      <Card />
    </View>
  );
}

afterEach(() => jest.restoreAllMocks());

it('updates nested surfaces and text on live theme changes without subscription gaps', () => {
  let scheme: 'light' | 'dark' = 'light';
  const listeners = new Set<Parameters<typeof Appearance.addChangeListener>[0]>();
  jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => scheme);
  const subscribe = jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  const view = render(<Page title="Profile" />);
  const subscriptions = subscribe.mock.calls.length;
  expect(subscriptions).toBeGreaterThan(0);
  expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: palette.light.background });

  for (const next of ['dark', 'light', 'dark'] as const) {
    act(() => {
      scheme = next;
      listeners.forEach((listener) => listener({ colorScheme: next }));
    });
    expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: palette[next].background });
    expect(screen.getByTestId('card')).toHaveStyle({ backgroundColor: palette[next].surface });
    expect(screen.getByTestId('card-label')).toHaveStyle({ color: palette[next].textPrimary });
    view.rerender(<Page title={`Profile in ${next}`} />);
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
  }

  view.unmount();
  expect(listeners.size).toBe(0);
});
