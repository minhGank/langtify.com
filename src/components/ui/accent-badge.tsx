import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

// Soft surfaces keep streak/reward accents distinct without dominating the page.
export function AccentBadge({
  label,
  tone,
  icon,
  announce = false,
}: {
  label: string;
  tone: 'energy' | 'reward';
  icon?: ComponentProps<typeof Ionicons>['name'];
  announce?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone === 'energy' ? colors.energySoft : colors.rewardSoft },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={16}
          color={tone === 'energy' ? colors.energyInk : colors.rewardInk}
          accessible={false}
        />
      )}
      <AppText
        variant="caption"
        accessibilityLiveRegion={announce ? 'polite' : undefined}
        style={{ color: colors.textPrimary, fontWeight: '600', flexShrink: 1 }}
      >
        {label}
      </AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
});
