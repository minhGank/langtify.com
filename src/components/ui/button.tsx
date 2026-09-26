import { ActivityIndicator, Animated, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';
import { usePressMotion } from '@/hooks/use-press-motion';

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
  const press = usePressMotion(disabled || loading);
  const backgroundColor = {
    primary: colors.brandPrimary,
    secondary: colors.surfaceMuted,
    ghost: 'transparent',
    danger: colors.errorSoft,
  }[variant];
  const foregroundColor = disabled
    ? colors.textSecondary
    : {
        primary: colors.textOnPrimary,
        secondary: colors.textPrimary,
        ghost: colors.brandText,
        danger: colors.error,
      }[variant];
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: disabled
              ? colors.surfaceMuted
              : pressed && !loading
                ? variant === 'primary'
                  ? colors.brandPrimaryPressed
                  : variant === 'danger'
                    ? colors.errorSoft
                    : colors.brandSoft
                : backgroundColor,
            borderColor: pressed && variant === 'danger' ? colors.error : 'transparent',
          },
        ]}
      >
        {loading && <ActivityIndicator color={foregroundColor} />}
        <AppText
          style={{ color: foregroundColor, fontWeight: '600', textAlign: 'center', flexShrink: 1 }}
        >
          {label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
