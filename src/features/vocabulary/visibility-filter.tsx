import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { feedback } from '@/lib/haptics';
import type { VisibilityFilter } from '@/services/vocabulary';

const options: { value: VisibilityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];
export function VisibilityFilterControl({
  value,
  onChange,
}: {
  value: VisibilityFilter;
  onChange: (value: VisibilityFilter) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Photo visibility"
      style={[styles.group, { backgroundColor: colors.surfaceMuted }]}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          onPress={() => {
            if (value !== option.value) {
              feedback.selection();
              onChange(option.value);
            }
          }}
          style={({ pressed }) => [
            styles.option,
            {
              backgroundColor:
                value === option.value
                  ? colors.surface
                  : pressed
                    ? colors.brandSoft
                    : 'transparent',
              borderColor: value === option.value ? colors.controlBorder : 'transparent',
            },
          ]}
        >
          <AppText
            variant="label"
            style={{
              color: value === option.value ? colors.brandText : colors.textSecondary,
              textAlign: 'center',
            }}
          >
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  option: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
