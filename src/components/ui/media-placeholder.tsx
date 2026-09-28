import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/hooks/use-app-theme';

// Static, quiet artwork occupies the image's existing frame. No shimmer/timers;
// Reduce Motion and slow connections get the same stable geometry.
export function MediaPlaceholder({ label = 'Loading photo' }: { label?: string }) {
  const { colors } = useAppTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      style={[styles.fill, { backgroundColor: colors.surfaceMuted }]}
    >
      <Ionicons name="image-outline" size={32} color={colors.controlBorder} accessible={false} />
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
