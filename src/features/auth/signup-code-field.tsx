import { useState } from 'react';
import { Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { radius } from '@/lib/theme';

export function SignupCodeField({
  length,
  value,
  onChangeText,
  onSubmit,
  disabled,
}: {
  length: number;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <AppText variant="label">Verification code</AppText>
      <View>
        <View
          style={styles.slots}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {Array.from({ length }, (_, index) => (
            <View
              key={index}
              testID="signup-code-slot"
              style={[
                styles.slot,
                fontScale > 1.5 && styles.largeSlot,
                {
                  backgroundColor: disabled ? colors.surfaceMuted : colors.surface,
                  borderColor:
                    !disabled && focused && index === Math.min(value.length, length - 1)
                      ? colors.brandPrimary
                      : colors.controlBorder,
                },
              ]}
            >
              <AppText variant="heading" style={styles.digit}>
                {value[index] ?? ' '}
              </AppText>
            </View>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Verification code"
          accessibilityHint={`Enter the ${length}-digit code from your email.`}
          accessibilityState={{ disabled }}
          value={value}
          onChangeText={onChangeText}
          maxLength={length}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          textContentType="oneTimeCode"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          caretHidden
          selectionColor={colors.brandPrimary}
          underlineColorAndroid="transparent"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmit}
          returnKeyType="done"
          style={styles.input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slot: {
    flex: 1,
    minHeight: 56,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeSlot: { flexBasis: '28%' },
  digit: { fontVariant: ['tabular-nums'] },
  // One native editing/autofill target; slots are decorative, not six focus stops.
  input: { ...StyleSheet.absoluteFill, color: 'transparent', fontSize: 24 },
});
