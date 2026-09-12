import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

type FormFieldProps = TextInputProps & { label: string; error?: string; hint?: string };
export function FormField({ label, error, hint, style, ...props }: FormFieldProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <AppText style={styles.label}>{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          style,
        ]}
      />
      {hint && <AppText>{hint}</AppText>}
      {error && (
        <AppText accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
