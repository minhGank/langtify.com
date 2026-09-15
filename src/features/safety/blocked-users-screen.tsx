import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { safetyGateway } from '@/services/safety';
import type { BlockedUser, SafetyIdentity, SafetyPage } from './model';
import { useSafetyTask } from './use-safety-task';
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
  const gateway = useMemo(() => safetyGateway({ userId, token }), [userId, token]);
  const [page, setPage] = useState<SafetyPage<BlockedUser> | null>(null),
    [selected, setSelected] = useState<BlockedUser | null>(null);
  const task = useSafetyTask(
    () => {
      setPage(null);
      setSelected(null);
    },
    (run) => {
      void run((signal) => gateway.blocks(null, signal), setPage);
    },
  );
  function load(cursor: string | null) {
    if (!task.busy) {
      setSelected(null);
      void task.run((signal) => gateway.blocks(cursor, signal), setPage);
    }
  }
  return (
    <Screen>
      <AppText variant="title">Blocked users</AppText>
      <AppText>
        Blocks hide public content in both directions. Your private vocabulary is unaffected.
      </AppText>
      {page?.items.length === 0 && <AppText>No blocked users on this page.</AppText>}
      {page?.items.map((user) => (
        <Button
          key={user.id}
          label={`Unblock @${user.username}`}
          disabled={task.busy}
          onPress={() => setSelected(user)}
        />
      ))}
      {selected && (
        <>
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
                  return gateway.blocks(null, signal);
                },
                (result) => {
                  setSelected(null);
                  setPage(result);
                },
              )
            }
          />
          <Button label="Cancel unblock" disabled={task.busy} onPress={() => setSelected(null)} />
        </>
      )}
      {task.error && <AppText accessibilityRole="alert">{task.error}</AppText>}
      {page?.hasMore && (
        <Button
          label="Next page"
          disabled={task.busy}
          onPress={() => load(page.items.at(-1)?.id ?? null)}
        />
      )}
      <Button label="Refresh blocked users" loading={task.busy} onPress={() => load(null)} />
      <Button label="Back to Profile" onPress={() => router.replace('/(tabs)/profile')} />
    </Screen>
  );
}
