import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

type ChoiceFieldProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
};
export function ChoiceField({
  label,
  value,
  options,
  onChange,
  error,
  disabled,
}: ChoiceFieldProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.group}>
      <AppText style={{ fontWeight: '600' }}>{label}</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: value === option.value, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.choice,
              {
                borderColor: value === option.value ? colors.primary : colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <AppText>
              {value === option.value ? '●' : '○'} {option.label}
            </AppText>
          </Pressable>
        ))}
      </View>
      {error && <AppText accessibilityRole="alert">{error}</AppText>}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 8 },
  choice: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48 },
});
