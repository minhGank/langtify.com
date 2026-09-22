import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';

export function SearchEmpty({
  loading = false,
  error = false,
  title,
  hint,
}: {
  loading?: boolean;
  error?: boolean;
  title: string;
  hint?: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.empty}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Searching" color={colors.primary} />
      ) : (
        <>
          <Ionicons name="search-outline" size={32} color={colors.muted} accessible={false} />
          <AppText variant="heading">{error ? 'Search unavailable' : title}</AppText>
          {hint && (
            <AppText variant="caption" style={styles.center}>
              {hint}
            </AppText>
          )}
        </>
      )}
    </View>
  );
}
export function SearchFooter({
  loading,
  error,
  hasMore,
  fromStart,
  more,
  refresh,
}: {
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  fromStart: boolean;
  more: () => void;
  refresh: () => void;
}) {
  return (
    <View style={styles.footer}>
      {error ? (
        <Button label="Retry search" variant="secondary" onPress={refresh} />
      ) : (
        hasMore && (
          <Button label="More results" variant="secondary" disabled={loading} onPress={more} />
        )
      )}
      {!fromStart && <Button label="Back to first results" variant="ghost" onPress={refresh} />}
    </View>
  );
}
const styles = StyleSheet.create({
  empty: { padding: 28, gap: 12, alignItems: 'center' },
  center: { textAlign: 'center' },
  footer: { paddingVertical: 20, gap: 12 },
});
