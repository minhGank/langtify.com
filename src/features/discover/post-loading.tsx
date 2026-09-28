import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { MediaPlaceholder } from '@/components/ui/media-placeholder';
import { useAppTheme } from '@/hooks/use-app-theme';

export function PostLoading() {
  const { colors } = useAppTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading photo"
      accessibilityState={{ busy: true }}
      style={[styles.page, { backgroundColor: colors.surface }]}
    >
      <View
        style={styles.photo}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <MediaPlaceholder />
      </View>
      <View style={styles.context}>
        <View style={[styles.title, { backgroundColor: colors.border }]} />
        <View style={[styles.line, { backgroundColor: colors.surfaceMuted }]} />
        <View style={styles.author}>
          <View style={[styles.circle, { backgroundColor: colors.surfaceMuted }]} />
          <View style={[styles.line, { backgroundColor: colors.surfaceMuted }]} />
        </View>
      </View>
    </View>
  );
}
export function PostRefreshState({
  pending,
  error,
  refresh,
}: {
  pending: boolean;
  error?: string | null;
  refresh: () => void;
}) {
  if (pending)
    return (
      <AppText variant="caption" accessibilityLiveRegion="polite">
        Refreshing photo…
      </AppText>
    );
  if (!error) return null;
  return (
    <View style={styles.notice}>
      <AppText variant="caption" accessibilityRole="alert">
        {error}
      </AppText>
      <Button label="Refresh photo" variant="ghost" onPress={refresh} />
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  photo: { width: '100%', aspectRatio: 1 },
  context: { padding: 20, gap: 14 },
  title: { width: '65%', height: 32, borderRadius: 8 },
  line: { width: '45%', height: 16, borderRadius: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: 36, height: 36, borderRadius: 18 },
  notice: { gap: 4 },
});
