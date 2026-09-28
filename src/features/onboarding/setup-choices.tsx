import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { feedback } from '@/lib/haptics';

export type SetupOption = { value: string; label: string; detail?: string; badge?: string };

export function SetupChoices({
  label,
  value,
  options,
  onChange,
  error,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly SetupOption[];
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.group}>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.badge ? `${option.badge} — ${option.label}` : option.label}
              accessibilityHint={option.detail}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => {
                if (selected || disabled) return;
                feedback.selection();
                onChange(option.value);
              }}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                  borderColor: error
                    ? colors.error
                    : selected
                      ? colors.brandPrimary
                      : colors.border,
                },
              ]}
            >
              {option.badge && (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: selected ? colors.brandSoft : colors.surfaceMuted },
                  ]}
                >
                  <AppText
                    variant="label"
                    style={{ color: selected ? colors.brandText : colors.textSecondary }}
                  >
                    {option.badge}
                  </AppText>
                </View>
              )}
              <View style={styles.words}>
                <AppText
                  style={{
                    fontWeight: '600',
                    color: disabled ? colors.textSecondary : colors.textPrimary,
                  }}
                >
                  {option.label}
                </AppText>
                {option.detail && <AppText variant="caption">{option.detail}</AppText>}
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={selected ? colors.brandPrimary : colors.controlBorder}
                accessible={false}
              />
            </Pressable>
          );
        })}
      </View>
      {error && (
        <AppText
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
  group: { gap: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 18,
    minHeight: 76,
  },
  words: { flex: 1, gap: 4 },
  badge: {
    minWidth: 44,
    minHeight: 44,
    padding: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
