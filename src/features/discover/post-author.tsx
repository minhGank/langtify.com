import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

export function PostAuthor({
  username,
  uri,
  date,
  onPress,
}: {
  username: string;
  uri?: string;
  date?: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View @${username}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Avatar username={username} uri={uri} size={36} />
      </View>
      <View style={styles.identity}>
        <AppText variant="label">@{username}</AppText>
        {date && (
          <AppText variant="caption">
            {new Date(date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: 12,
    paddingVertical: 6,
  },
  identity: { flex: 1, gap: 2 },
});
