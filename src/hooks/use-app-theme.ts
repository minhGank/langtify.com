import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { palette } from '@/lib/theme';

// Keep subscriptions stable while parent and child surfaces update together.
// Resubscribing during a web matchMedia dispatch can miss that same change.
const subscribe = (notify: () => void) => {
  const subscription = Appearance.addChangeListener(notify);
  return () => subscription.remove();
};
const getColorScheme = () => Appearance.getColorScheme();

export function useAppTheme() {
  const isDark = useSyncExternalStore(subscribe, getColorScheme, getColorScheme) === 'dark';
  return { isDark, colors: palette[isDark ? 'dark' : 'light'] };
}
