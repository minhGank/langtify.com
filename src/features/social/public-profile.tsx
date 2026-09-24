import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { Sheet } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { socialGateway, type PublicProfileTarget } from '@/services/social';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { discardPublicData, followChanged, profileCache, socialChanged } from './cache';
import { ProfileAvatar } from '@/features/profile/profile-avatar';
import { followWithRecovery } from './follow-operation';
import { openConnections } from './connections-navigation';
import { PublicProfilePosts } from './public-profile-posts';

export function PublicProfilePanel({
  identity,
  target,
  close,
  onBlur,
}: {
  identity: SafetyIdentity;
  target?: PublicProfileTarget;
  close: () => void;
  onBlur?: () => void;
}) {
  const { colors } = useAppTheme();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const key = target
    ? 'profileId' in target
      ? target.profileId
      : `post:${target.submissionId}`
    : 'self';
  const entry = useMemo(
    () =>
      profileCache.entry(`${serverScope(identity.userId, identity.token)}:profile:${key}`, [
        'public-profile',
        'follows',
      ]),
    [identity, key],
  );
  const load = useCallback(
    (signal: AbortSignal) => gateway.profile(target, signal),
    [gateway, target],
  );
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable)) return false;
      discardPublicData(identity, entry);
      return true;
    },
    [identity, entry],
  );
  const query = useServerQuery(entry, load, { staleTime: 60000, discardOnError });
  const task = useSafetyTask(
    () => {
      setConfirmBlock(false);
      onBlur?.();
    },
    undefined,
    () => {
      // A denied interaction can signal a block/restriction. Do not reopen
      // previously eligible profile, search, comment, or photo cache entries.
      discardPublicData(identity);
      close();
    },
  );
  const profile = query.data;
  return (
    <View style={styles.content}>
      {query.loading && !profile && (
        <ActivityIndicator
          accessibilityLabel="Loading public profile"
          color={colors.brandPrimary}
        />
      )}
      {profile && (
        <>
          <View style={styles.identity}>
            <ProfileAvatar
              identity={identity}
              username={profile.username}
              avatarId={profile.avatarId}
              size={88}
            />
            <AppText variant="title">@{profile.username}</AppText>
            <View style={styles.counts}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${profile.followerCount} followers`}
                onPress={() => openConnections(profile.id, 'followers')}
                style={styles.count}
              >
                <AppText variant="heading">{profile.followerCount}</AppText>
                <AppText variant="caption">Followers</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${profile.followingCount} following`}
                onPress={() => openConnections(profile.id, 'following')}
                style={styles.count}
              >
                <AppText variant="heading">{profile.followingCount}</AppText>
                <AppText variant="caption">Following</AppText>
              </Pressable>
            </View>
          </View>
          {!profile.isSelf && (
            <Button
              label={profile.isFollowing ? 'Following · Unfollow' : 'Follow'}
              variant={profile.isFollowing ? 'secondary' : 'primary'}
              loading={task.busy}
              disabled={!!task.error}
              onPress={() =>
                void task.run(
                  (signal) =>
                    followWithRecovery(identity, signal, () =>
                      gateway.follow(profile.id, !profile.isFollowing, signal),
                    ),
                  (receipt) => followChanged(identity, receipt),
                )
              }
            />
          )}
          {!profile.isSelf && (
            <Button
              label="Block account"
              variant="ghost"
              disabled={task.busy}
              onPress={() => setConfirmBlock(true)}
            />
          )}
          <PublicProfilePosts identity={identity} profileId={profile.id} isOwn={profile.isSelf} />
        </>
      )}
      {(query.error || task.error) && (
        <>
          <AppText accessibilityRole="alert" style={{ color: colors.error }}>
            {task.error ?? 'This profile could not be loaded.'}
          </AppText>
          <Button
            label="Retry profile"
            variant="secondary"
            onPress={() =>
              void task.run(
                async () => {
                  await query.refresh();
                  if (entry.getSnapshot().error) throw new Error('Profile refresh failed.');
                },
                () => {},
              )
            }
          />
        </>
      )}
      <Sheet visible={confirmBlock} title="Block account" onClose={() => setConfirmBlock(false)}>
        <AppText>Block @{profile?.username}?</AppText>
        <AppText>
          You will stop seeing each other’s public content and social relationships. You can unblock
          them in Profile.
        </AppText>
        <Button
          label="Confirm block"
          variant="danger"
          loading={task.busy}
          onPress={() => {
            if (profile)
              void task.run(
                (signal) => gateway.block(profile.id, signal),
                () => {
                  socialChanged('block');
                  close();
                },
              );
          }}
        />
        {task.error && <AppText accessibilityRole="alert">{task.error}</AppText>}
      </Sheet>
    </View>
  );
}
export function PublicProfileSheet({
  identity,
  target,
  close,
}: {
  identity: SafetyIdentity;
  target: PublicProfileTarget;
  close: () => void;
}) {
  return (
    <Sheet visible title="Public profile" onClose={close}>
      <PublicProfilePanel identity={identity} target={target} close={close} onBlur={close} />
    </Sheet>
  );
}
export function PublicProfileScreen() {
  const { status, session } = useAuth();
  const { profileId } = useLocalSearchParams<{ profileId?: string | string[] }>();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  const target = useMemo(
    () =>
      typeof profileId === 'string' &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profileId)
        ? { profileId: profileId.toLowerCase() }
        : undefined,
    [profileId],
  );
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  if (status !== 'ready' || !identity) return null;
  return (
    <Screen>
      <IconButton name="chevron-back" label="Back" onPress={close} />
      {profileId && !target ? (
        <AppText>This profile is unavailable.</AppText>
      ) : (
        <PublicProfilePanel
          key={`${identity.userId}:${identity.token}:${profileId ?? 'self'}`}
          identity={identity}
          target={target}
          close={close}
        />
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: 20 },
  identity: { alignItems: 'center', gap: 16, paddingVertical: 24 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { minHeight: 48, minWidth: 80, alignItems: 'center', justifyContent: 'center', gap: 4 },
  counts: { flexDirection: 'row', gap: 24, flexWrap: 'wrap', justifyContent: 'center' },
});
