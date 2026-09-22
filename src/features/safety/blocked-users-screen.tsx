import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { safetyGateway } from '@/services/safety';
import type { BlockedUser, SafetyIdentity, SafetyPage } from './model';
import { useSafetyTask } from './use-safety-task';
import { socialChanged } from '@/features/social/cache';
export function BlockedUsersScreen() {
  const { status, session } = useAuth();
  return status === 'ready' && session ? (
    <BlockedUsers
      key={`${session.user.id}:${session.access_token}`}
      userId={session.user.id}
      token={session.access_token}
    />
  ) : null;
}
function BlockedUsers({ userId, token }: SafetyIdentity) {
  const { colors } = useAppTheme();
  const [olderPage, setOlderPage] = useState(false);
  const gateway = useMemo(() => safetyGateway({ userId, token }), [userId, token]);
  const [page, setPage] = useState<SafetyPage<BlockedUser> | null>(null),
    [selected, setSelected] = useState<BlockedUser | null>(null);
  const task = useSafetyTask(
    () => {
      setPage(null);
      setOlderPage(false);
      setSelected(null);
    },
    (run) => {
      void run((signal) => gateway.blocks(null, signal), setPage);
    },
  );
  function load(cursor: string | null) {
    if (!task.busy) {
      setSelected(null);
      setOlderPage(cursor !== null);
      void task.run((signal) => gateway.blocks(cursor, signal), setPage);
    }
  }
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton
          name="chevron-back"
          label="Back to Profile"
          onPress={() => router.replace('/(tabs)/profile')}
        />
        <AppText variant="heading">Blocked users</AppText>
      </View>
      <AppText>
        You won’t see each other’s public photos. Unblock someone to see their posts again.
      </AppText>
      {page?.items.length === 0 && <AppText>No blocked users on this page.</AppText>}
      {page?.items.map((user) => (
        <Button
          key={user.id}
          variant="secondary"
          label={`Unblock @${user.username}`}
          disabled={task.busy}
          onPress={() => setSelected(user)}
        />
      ))}
      {selected && (
        <Sheet visible title="Unblock account" onClose={() => setSelected(null)}>
          <AppText>
            Unblock @{selected.username}? Eligible public content will be visible again.
          </AppText>
          <Button
            label="Confirm unblock"
            loading={task.busy}
            onPress={() =>
              void task.run(
                async (signal) => {
                  await gateway.unblock(selected.id, signal);
                  if (signal.aborted) throw new Error('Request cancelled.');
                  socialChanged('block');
                  return gateway.blocks(null, signal);
                },
                (result) => {
                  setSelected(null);
                  setOlderPage(false);
                  setPage(result);
                },
              )
            }
          />
          <Button
            variant="ghost"
            label="Cancel unblock"
            disabled={task.busy}
            onPress={() => setSelected(null)}
          />
        </Sheet>
      )}
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {task.error}
        </AppText>
      )}
      {page?.hasMore && (
        <Button
          variant="secondary"
          label="Next page"
          disabled={task.busy}
          onPress={() => load(page.items.at(-1)?.id ?? null)}
        />
      )}
      {task.busy && (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading blocked users" />
      )}
      {task.error && (
        <Button
          variant="secondary"
          label="Refresh blocked users"
          loading={task.busy}
          onPress={() => load(null)}
        />
      )}
      {olderPage && (
        <Button
          variant="ghost"
          label="Back to first page"
          disabled={task.busy}
          onPress={() => load(null)}
        />
      )}
    </Screen>
  );
}
