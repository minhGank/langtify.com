import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';

type ButtonProps = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};
export function Button({
  label,
  accessibilityLabel,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonProps) {
  const { colors } = useAppTheme();
  const backgroundColor = {
    primary: colors.primary,
    secondary: colors.surfaceMuted,
    ghost: 'transparent',
    danger: colors.dangerSoft,
  }[variant];
  const foregroundColor = {
    primary: colors.onPrimary,
    secondary: colors.text,
    ghost: colors.primary,
    danger: colors.danger,
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {loading && <ActivityIndicator color={foregroundColor} />}
      <AppText
        style={{ color: foregroundColor, fontWeight: '600', textAlign: 'center', flexShrink: 1 }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
