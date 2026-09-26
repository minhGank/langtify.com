import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/hooks/use-app-theme';

// Static shapes reserve content space without shimmering, fake content or timers.
export function LoadingPlaceholder({ label, photo = false }: { label: string; photo?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={styles.container}
    >
      <View
        style={[styles.blocks, photo && styles.photo, { backgroundColor: colors.surfaceMuted }]}
      />
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      <View style={[styles.line, styles.short, { backgroundColor: colors.surfaceMuted }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 12, width: '100%', paddingVertical: 12 },
  blocks: { height: 64, borderRadius: 16 },
  photo: { height: undefined, aspectRatio: 4 / 3 },
  line: { height: 14, width: '72%', borderRadius: 7 },
  short: { width: '46%' },
});
