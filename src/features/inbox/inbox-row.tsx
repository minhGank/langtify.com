import { displayTerm } from '@/utils/display-term';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
      return 'Your daily words are ready';
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
  disabled,
  open,
  toggleRead,
}: {
  item: InboxNotification;
  disabled: boolean;
  open: () => void;
  toggleRead: () => void;
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
          backgroundColor: item.read ? colors.surface : colors.primarySoft,
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
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: item.read ? colors.surfaceMuted : colors.surface },
          ]}
        >
          <Ionicons name={icon(item)} size={23} color={colors.primary} accessible={false} />
        </View>
        <View style={styles.body}>
          <AppText style={{ fontWeight: item.read ? '500' : '700' }}>{label}</AppText>
          <AppText variant="caption">{context(item)}</AppText>
        </View>
        {!item.read && (
          <View
            accessibilityElementsHidden
            style={[styles.dot, { backgroundColor: colors.primary }]}
          />
        )}
        <Ionicons name="chevron-forward" size={18} color={colors.muted} accessible={false} />
      </Pressable>
      <View style={styles.footer}>
        <AppText variant="caption" style={styles.timestamp}>
          {date}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark as ${item.read ? 'unread' : 'read'}: ${label}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={toggleRead}
          style={({ pressed }) => [styles.readButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppText variant="caption" style={{ color: colors.primary, fontWeight: '600' }}>
            Mark {item.read ? 'unread' : 'read'}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  main: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  footer: {
    marginLeft: 72,
    paddingRight: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timestamp: { flexShrink: 1, fontSize: 11 },
  readButton: { minHeight: 44, justifyContent: 'center' },
});
