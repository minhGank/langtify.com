import { useMemo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { FeedPhoto } from '@/features/discover/feed-photo';
import { openPost } from '@/features/discover/open-post';
import { displayTerm } from '@/utils/display-term';
import { useDiscover } from '@/features/discover/use-discover';
import type { SafetyIdentity } from '@/features/safety/model';
import { useAppTheme } from '@/hooks/use-app-theme';
import { serverScope } from '@/lib/server-cache';
import { feedGateway, type FeedIdentity } from '@/services/discover';

export function PublicProfilePosts({
  identity,
  profileId,
  isOwn = false,
}: {
  identity: SafetyIdentity;
  profileId: string;
  isOwn?: boolean;
}) {
  const { session, account, status, reload } = useAuth();
  if (status !== 'ready' || session?.user.id !== identity.userId || !account?.learning) return null;
  const targetLanguageId = account.learning.target_language_id;
  const language =
    account.languages.find((item) => item.id === targetLanguageId)?.name ??
    'Your learning language';
  return (
    <ProfilePosts
      key={`${serverScope(identity.userId, identity.token)}:${targetLanguageId}:${profileId}`}
      {...identity}
      profileId={profileId}
      isOwn={isOwn}
      targetLanguageId={targetLanguageId}
      language={language}
      reloadAccount={reload}
    />
  );
}

function ProfilePosts({
  userId,
  token,
  targetLanguageId,
  profileId,
  language,
  reloadAccount,
  isOwn,
}: FeedIdentity & {
  profileId: string;
  language: string;
  reloadAccount: () => void;
  isOwn: boolean;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => feedGateway({ userId, token, targetLanguageId }, profileId),
    [userId, token, targetLanguageId, profileId],
  );
  const state = useDiscover(
    gateway,
    `${serverScope(userId, token)}:public-posts:${profileId}:${targetLanguageId}`,
    serverScope(userId, token),
  );
  return (
    <View style={styles.content}>
      <AppText variant="heading">{isOwn ? 'Your public photos' : 'Photos'}</AppText>
      <AppText variant="caption">{language} · Newest first</AppText>
      <View style={styles.grid}>
        {state.items.map((item) => (
          <View key={item.id} style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
            <FeedPhoto
              key={`${item.id}:${state.photoRevision}`}
              word={displayTerm(item.targetTerm)}
              uri={state.photos[item.id]}
              reload={() => void state.renew()}
              open={() => openPost({ userId, token, targetLanguageId }, item)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${displayTerm(item.targetTerm)}`}
              onPress={() => openPost({ userId, token, targetLanguageId }, item)}
              style={styles.caption}
            >
              <AppText variant="label">{displayTerm(item.targetTerm)}</AppText>
              <AppText variant="caption">{displayTerm(item.referenceTerm)}</AppText>
            </Pressable>
          </View>
        ))}
      </View>
      {state.loading && (
        <ActivityIndicator accessibilityLabel="Loading public photos" color={colors.primary} />
      )}
      {!state.loading && !state.error && state.items.length === 0 && (
        <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="images-outline" size={30} color={colors.muted} accessible={false} />
          <AppText variant="label">
            {state.hasMore
              ? 'More photos to explore'
              : isOwn
                ? 'Your photos, shared'
                : 'No photos yet'}
          </AppText>
          {isOwn && !state.hasMore && (
            <AppText variant="caption" style={styles.emptyText}>
              Your public captures will appear here.
            </AppText>
          )}
        </View>
      )}
      {state.error && (
        <>
          <AppText accessibilityRole="alert">Public photos could not be loaded.</AppText>
          <Button
            label="Retry public photos"
            variant="secondary"
            onPress={() => void state.refresh()}
          />
          {state.settingsChanged && (
            <Button
              label="Reload account"
              variant="secondary"
              onPress={() => void reloadAccount()}
            />
          )}
        </>
      )}
      {state.hasMore && !state.loading && (
        <Button
          label="More public photos"
          variant="secondary"
          onPress={() => void state.loadMore()}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '46%', flexGrow: 1, maxWidth: '49%', borderRadius: 16, overflow: 'hidden' },
  caption: { minHeight: 56, padding: 10, gap: 4 },
  empty: { alignItems: 'center', gap: 10, padding: 28, borderRadius: 20 },
  emptyText: { textAlign: 'center' },
});
