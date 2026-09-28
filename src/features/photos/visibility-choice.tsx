import { StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
export function VisibilityChoice({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.choice, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons
        name={value ? 'globe-outline' : 'lock-closed-outline'}
        size={22}
        color={colors.textSecondary}
      />
      <View style={styles.choiceText}>
        <AppText variant="label">Share publicly</AppText>
        <AppText variant="caption">
          {value ? 'Visible to other learners' : 'Private · not shared'}
        </AppText>
      </View>
      <Switch
        accessibilityLabel="Share this photo publicly"
        accessibilityHint="Show this photo on your profile and in Discover."
        accessibilityState={{ disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{
          true: disabled ? colors.controlBorder : colors.brandPrimary,
          false: colors.controlBorder,
        }}
        thumbColor={value && !disabled ? colors.textOnPrimary : colors.surface}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  choice: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  choiceText: { flex: 1, gap: 3 },
});
