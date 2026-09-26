import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';

// Explicit refresh/retry and account changes replace this instance. Pagination
// keeps existing instances; downloaded pixels are separate from signed access.
export function FeedPhoto({
  uri,
  word,
  reload,
  detail = false,
  open,
}: {
  uri?: string;
  word: string;
  reload: () => void;
  detail?: boolean;
  open?: () => void;
}) {
  const { colors } = useAppTheme();
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <View style={[styles.frame, { backgroundColor: colors.surfaceMuted }]}>
      {uri && !failed ? (
        <>
          <Pressable
            disabled={!open}
            onPress={open}
            style={styles.photo}
            accessible={Boolean(open)}
            accessibilityRole={open ? 'button' : undefined}
            accessibilityLabel={open ? `Open photo: ${word}` : undefined}
            accessibilityHint={open ? 'Open the photo and its ratings' : undefined}
          >
            <Image
              source={{ uri, cache: 'reload' }}
              style={styles.photo}
              resizeMode={detail ? 'contain' : 'cover'}
              accessibilityLabel={`Photo of ${word}`}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </Pressable>
          {!loaded && (
            <View pointerEvents="none" style={styles.center}>
              <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading photo" />
            </View>
          )}
        </>
      ) : (
        <View style={styles.center}>
          <Ionicons name="image-outline" size={30} color={colors.textSecondary} />
          <AppText variant="caption">Photo unavailable</AppText>
          <Button label="Reload photos" variant="secondary" onPress={reload} />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});
