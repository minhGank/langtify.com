import { StyleSheet, Text, type TextProps } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

type AppTextProps = TextProps & {
  variant?: 'body' | 'title';
};

export function AppText({ variant = 'body', style, ...props }: AppTextProps) {
  const { colors } = useAppTheme();

  return (
    <Text
      accessibilityRole={variant === 'title' ? 'header' : undefined}
      {...props}
      style={[styles[variant], { color: colors.text }, style]}
    />
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 24 },
  title: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
});
