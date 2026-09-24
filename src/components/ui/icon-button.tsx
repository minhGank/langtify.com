import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

type IconButtonProps = {
  name: ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'plain' | 'surface' | 'danger';
};

export function IconButton({
  name,
  label,
  hint,
  onPress,
  disabled = false,
  variant = 'plain',
}: IconButtonProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            pressed && !disabled
              ? variant === 'danger'
                ? colors.errorSoft
                : colors.brandSoft
              : variant === 'surface'
                ? colors.surfaceMuted
                : 'transparent',
        },
      ]}
    >
      <Ionicons
        name={name}
        size={24}
        color={
          disabled ? colors.textSecondary : variant === 'danger' ? colors.error : colors.textPrimary
        }
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    minWidth: 48,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
