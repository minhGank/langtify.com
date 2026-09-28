import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';

type FormFieldProps = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  endAdornment?: ReactNode;
  ref?: Ref<TextInput>;
};
export function FormField({
  label,
  error,
  hint,
  required = false,
  style,
  onFocus,
  onBlur,
  endAdornment,
  ref,
  ...props
}: FormFieldProps) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <AppText variant="label">
        {label}
        {required && <AppText style={{ color: colors.textSecondary }}> *</AppText>}
      </AppText>
      <View>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={[required ? 'Required.' : '', error ?? hint].filter(Boolean).join(' ')}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.brandPrimary}
          {...props}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            {
              color: props.editable === false ? colors.textSecondary : colors.textPrimary,
              borderColor: error
                ? colors.error
                : focused
                  ? colors.brandPrimary
                  : colors.controlBorder,
              backgroundColor: props.editable === false ? colors.surfaceMuted : colors.surface,
            },
            style,
            endAdornment ? { paddingRight: 60 } : undefined,
          ]}
        />
        {endAdornment && <View style={styles.adornment}>{endAdornment}</View>}
      </View>
      {hint && !error && <AppText variant="caption">{hint}</AppText>}
      {error && (
        <AppText
          variant="caption"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: colors.error }}
        >
          {error}
        </AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 8 },
  adornment: { position: 'absolute', right: 4, top: 0, bottom: 0, justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
});
