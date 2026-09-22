import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';

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
        {required && <AppText style={{ color: colors.muted }}> *</AppText>}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: value === option.value, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: error
                  ? colors.danger
                  : value === option.value
                    ? colors.primary
                    : colors.border,
                backgroundColor: value === option.value ? colors.primarySoft : colors.surface,
                opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            {value === option.value && (
              <Ionicons name="checkmark" size={18} color={colors.primary} accessible={false} />
            )}
            <AppText
              variant="label"
              style={{
                color: value === option.value ? colors.primary : colors.text,
                flexShrink: 1,
              }}
            >
              {option.label}
            </AppText>
          </Pressable>
        ))}
      </View>
      {error && (
        <AppText variant="caption" accessibilityRole="alert" style={{ color: colors.danger }}>
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
