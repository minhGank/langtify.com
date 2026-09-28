import { displayTerm } from '@/utils/display-term';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { InboxNotification } from '@/services/inbox';

export function notificationLabel(item: InboxNotification) {
  switch (item.kind) {
    case 'NEW_FOLLOWER':
      return `@${item.username} started following you`;
    case 'NEW_RATING':
      return `Someone rated your photo for “${displayTerm(item.targetTerm)}”`;
    case 'DAILY_WORDS_READY':
      return 'Today’s words are ready';
  }
}
function icon(item: InboxNotification): ComponentProps<typeof Ionicons>['name'] {
  switch (item.kind) {
    case 'NEW_FOLLOWER':
      return 'person-add-outline';
    case 'NEW_RATING':
      return 'star-outline';
    case 'DAILY_WORDS_READY':
      return 'book-outline';
  }
}
function context(item: InboxNotification) {
  switch (item.kind) {
    case 'NEW_FOLLOWER':
      return 'View profile';
    case 'NEW_RATING':
      return 'View your photo';
    case 'DAILY_WORDS_READY':
      return 'Open Today’s Challenge';
  }
}
export function InboxRow({
  item,
  avatarUri,
  disabled,
  open,
}: {
  item: InboxNotification;
  avatarUri?: string;
  disabled: boolean;
  open: () => void;
}) {
  const { colors } = useAppTheme();
  const label = notificationLabel(item);
  const date = new Date(item.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: item.read ? undefined : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.read ? '' : 'Unread: '}${label}`}
        accessibilityHint={context(item)}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={open}
        style={({ pressed }) => [
          styles.main,
          { backgroundColor: pressed ? colors.surfaceMuted : undefined },
        ]}
      >
        {item.kind === 'NEW_FOLLOWER' ? (
          <Avatar username={item.username} uri={avatarUri} size={44} />
        ) : (
          <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name={icon(item)} size={23} color={colors.textSecondary} accessible={false} />
          </View>
        )}
        <View style={styles.body}>
          <AppText style={{ fontWeight: item.read ? '500' : '700' }}>{label}</AppText>
          <AppText variant="caption">{date}</AppText>
        </View>
        {!item.read && (
          <View
            accessibilityElementsHidden
            style={[styles.dot, { backgroundColor: colors.brandPrimary }]}
          />
        )}
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textSecondary}
          accessible={false}
        />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    paddingHorizontal: 4,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
