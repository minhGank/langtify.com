import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { NotificationBell } from '@/features/inbox/notification-bell';

// Each primary tab keeps its existing safe area and title hierarchy. The inbox
// entry shares one session-scoped summary rather than creating a header fetch.
export function TabHeading({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.row}>
      <AppText variant="title" style={styles.title}>
        {title}
      </AppText>
      <View style={styles.actions}>
        {children}
        <NotificationBell />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
