import { useColorScheme } from 'react-native';

import { palette } from '@/lib/theme';

export function useAppTheme() {
  const isDark = useColorScheme() === 'dark';
  return { isDark, colors: palette[isDark ? 'dark' : 'light'] };
}
