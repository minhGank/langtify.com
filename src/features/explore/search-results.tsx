import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { LoadingPlaceholder } from '@/components/ui/loading-placeholder';

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
        <LoadingPlaceholder label="Searching" />
      ) : (
        <>
          <View
            style={[
              styles.discoveryIcon,
              { backgroundColor: error ? colors.surfaceMuted : colors.accentEnergy },
            ]}
          >
            <Ionicons
              name="search-outline"
              size={28}
              color={error ? colors.textSecondary : colors.textOnAccent}
              accessible={false}
            />
          </View>
          <AppText variant="heading">{error ? 'We couldn’t load your search.' : title}</AppText>
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
        <Button label="Try again" variant="secondary" onPress={refresh} />
      ) : (
        hasMore && (
          <Button label="More results" variant="secondary" loading={loading} onPress={more} />
        )
      )}
      {!fromStart && <Button label="Back to first results" variant="ghost" onPress={refresh} />}
    </View>
  );
}
const styles = StyleSheet.create({
  discoveryIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { padding: 28, gap: 12, alignItems: 'center' },
  center: { textAlign: 'center' },
  footer: { paddingVertical: 20, gap: 12 },
});
