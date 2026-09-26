import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';
import { feedback } from '@/lib/haptics';

type ChoiceFieldProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
};
export function ChoiceField({
  label,
  value,
  options,
  onChange,
  error,
  disabled,
  required = false,
}: ChoiceFieldProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.group}>
      <AppText variant="label">
        {label}
        {required && <AppText style={{ color: colors.textSecondary }}> *</AppText>}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: value === option.value, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => {
              if (disabled || value === option.value) return;
              feedback.selection();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: error
                  ? colors.error
                  : value === option.value
                    ? colors.brandPrimary
                    : colors.controlBorder,
                backgroundColor: disabled
                  ? colors.surfaceMuted
                  : value === option.value || pressed
                    ? colors.brandSoft
                    : colors.surface,
              },
            ]}
          >
            {value === option.value && (
              <Ionicons name="checkmark" size={18} color={colors.brandPrimary} accessible={false} />
            )}
            <AppText
              variant="label"
              style={{
                color: disabled
                  ? colors.textSecondary
                  : value === option.value
                    ? colors.brandText
                    : colors.textPrimary,
                flexShrink: 1,
              }}
            >
              {option.label}
            </AppText>
          </Pressable>
        ))}
      </View>
      {error && (
        <AppText variant="caption" accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
