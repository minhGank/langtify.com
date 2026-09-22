import { StyleSheet, Text, type TextProps } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

type AppTextProps = TextProps & {
  variant?: 'title' | 'heading' | 'subtitle' | 'body' | 'caption' | 'label';
};

export function AppText({ variant = 'body', style, ...props }: AppTextProps) {
  const { colors } = useAppTheme();

  return (
    <Text
      accessibilityRole={variant === 'title' || variant === 'heading' ? 'header' : undefined}
      {...props}
      style={[
        styles[variant],
        { color: variant === 'caption' || variant === 'subtitle' ? colors.muted : colors.text },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 24 },
  title: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  heading: { fontSize: 23, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontSize: 17, lineHeight: 25 },
  caption: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
