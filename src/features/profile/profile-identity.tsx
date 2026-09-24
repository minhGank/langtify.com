import { useCallback, useMemo } from 'react';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import { SafetyUnavailable, type SafetyIdentity } from '@/features/safety/model';
import { discardPublicData, profileCache } from '@/features/social/cache';
import { socialGateway } from '@/services/social';
import { openConnections } from '@/features/social/connections-navigation';
import { ProfileAvatar } from './profile-avatar';
import { useAppTheme } from '@/hooks/use-app-theme';
import { PublicProfilePosts } from '@/features/social/public-profile-posts';

export function ProfileIdentity({
  userId,
  token,
  username,
}: SafetyIdentity & { username: string }) {
  const { colors } = useAppTheme();
  const identity = useMemo(() => ({ userId, token }), [userId, token]);
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      profileCache.entry(`${serverScope(userId, token)}:profile:self`, [
        'public-profile',
        'follows',
      ]),
    [userId, token],
  );
  const load = useCallback((signal: AbortSignal) => gateway.profile(undefined, signal), [gateway]);
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable)) return false;
      discardPublicData(identity, entry);
      return true;
    },
    [identity, entry],
  );
  const query = useServerQuery(entry, load, { staleTime: 60000, discardOnError });
  return (
    <View style={styles.section}>
      <View style={styles.identity}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile photo"
          accessibilityHint="Opens Edit Profile."
          onPress={() => router.push('/edit-profile')}
          style={({ pressed }) => [
            styles.avatarButton,
            { transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          <ProfileAvatar
            identity={identity}
            username={username}
            avatarId={query.data?.avatarId ?? null}
            size={64}
          />
          <View
            style={[
              styles.editIndicator,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="pencil" size={13} color={colors.textPrimary} accessible={false} />
          </View>
        </Pressable>
        <View style={styles.text}>
          <AppText variant="heading">@{query.data?.username ?? username}</AppText>
          {query.data && (
            <View style={styles.counts}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${query.data.followerCount} followers`}
                onPress={() => query.data && openConnections(query.data.id, 'followers')}
                style={styles.count}
              >
                <AppText variant="caption">{query.data.followerCount} followers</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${query.data.followingCount} following`}
                onPress={() => query.data && openConnections(query.data.id, 'following')}
                style={styles.count}
              >
                <AppText variant="caption">{query.data.followingCount} following</AppText>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      {query.data && <PublicProfilePosts identity={identity} profileId={query.data.id} isOwn />}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarButton: { width: 64, height: 64 },
  editIndicator: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 4 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  count: { minHeight: 44, justifyContent: 'center' },
});
