import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

type ButtonProps = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean };
export function Button({ label, onPress, loading = false, disabled = false }: ButtonProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.primary, opacity: disabled || loading || pressed ? 0.65 : 1 },
      ]}
    >
      {loading && <ActivityIndicator color={colors.surface} />}
      <AppText style={{ color: colors.surface, fontWeight: '600', textAlign: 'center' }}>
        {label}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    padding: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
