import { useCallback, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { useConnectionAvatars } from '@/features/social/connections-avatars';
import { safetyGateway } from '@/services/safety';
import { feedback } from '@/lib/haptics';
import { SafetyUnavailable, type SafetyIdentity } from './model';
import { blockedProfileCache, unblockChanged, unblockWithRecovery } from './blocked-cache';
import { useSafetyTask } from './use-safety-task';

export function BlockedProfile({
  identity,
  blockId,
  close,
}: {
  identity: SafetyIdentity;
  blockId: string;
  close: () => void;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => safetyGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      blockedProfileCache.entry(
        `${serverScope(identity.userId, identity.token)}:blocked-profile:${blockId}`,
        ['blocked-users', 'safety'],
      ),
    [identity, blockId],
  );
  const load = useCallback(
    (signal: AbortSignal) => gateway.blockedProfile(blockId, signal),
    [gateway, blockId],
  );
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError: unavailable });
  const profile = query.data;
  const avatars = useConnectionAvatars(
    identity,
    profile?.avatarId ? [profile.avatarId] : [],
    'blocked',
  );
  const task = useSafetyTask(
    () => {},
    undefined,
    () => entry.clear(),
  );
  return (
    <View style={{ gap: 24, alignItems: 'center', paddingVertical: 32 }}>
      {profile ? (
        <>
          <Avatar
            size={96}
            username={profile.username}
            uri={profile.avatarId ? avatars.photos[profile.avatarId] : undefined}
          />
          <AppText variant="title">@{profile.username}</AppText>
          <AppText variant="subtitle">Blocked account</AppText>
          <Button
            label="Unblock"
            variant="secondary"
            loading={task.busy}
            onPress={() =>
              void task.run(
                (signal) =>
                  unblockWithRecovery(identity, signal, () => gateway.unblock(blockId, signal)),
                () => {
                  unblockChanged(identity, blockId);
                  feedback.confirm();
                  close();
                },
              )
            }
          />
        </>
      ) : query.loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading blocked account"
          color={colors.brandPrimary}
        />
      ) : (
        <AppText>This blocked account is unavailable.</AppText>
      )}
      {(query.error || task.error) && (
        <>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {task.error ?? 'We couldn’t load this account. Try again.'}
          </AppText>
          <Button
            label="Try again"
            variant="ghost"
            onPress={() =>
              void task.run(
                async () => {
                  await Promise.all([query.refresh(), avatars.refresh()]);
                  if (entry.getSnapshot().error) throw new Error('Refresh failed.');
                },
                () => {},
              )
            }
            disabled={task.busy}
          />
        </>
      )}
    </View>
  );
}
const unavailable = (cause: unknown) => cause instanceof SafetyUnavailable;
