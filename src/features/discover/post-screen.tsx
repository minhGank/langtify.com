import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { nativeBackFallback } from '@/components/ui/native-back';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { serverScope } from '@/lib/server-cache';
import { feedGateway, type FeedIdentity } from '@/services/discover';
import { postCacheKey } from './open-post';
import { useDiscover } from './use-discover';
import { PostDetail } from './post-detail';

export function PostScreen() {
  const { status, session, account } = useAuth();
  const { submissionId } = useLocalSearchParams<{ submissionId?: string | string[] }>();
  if (status !== 'ready' || !session || !account?.learning) return null;
  const identity = {
    userId: session.user.id,
    token: session.access_token,
    targetLanguageId: account.learning.target_language_id,
  };
  const id =
    typeof submissionId === 'string' &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(submissionId)
      ? submissionId.toLowerCase()
      : null;
  const language =
    account.languages.find((item) => item.id === identity.targetLanguageId)?.name ?? 'Photo';
  return (
    <>
      <Stack.Screen options={{ headerLeft: nativeBackFallback() }} />
      {id ? (
        <PostContent key={postCacheKey(identity, id)} {...identity} id={id} language={language} />
      ) : (
        <UnavailablePost />
      )}
    </>
  );
}
function UnavailablePost() {
  return (
    <View style={styles.message}>
      <AppText variant="heading">Photo unavailable</AppText>
    </View>
  );
}
function PostContent({
  id,
  language,
  userId,
  token,
  targetLanguageId,
}: FeedIdentity & { id: string; language: string }) {
  const { colors } = useAppTheme();
  const identity = useMemo(
    () => ({ userId, token, targetLanguageId }),
    [userId, token, targetLanguageId],
  );
  const source = useMemo(() => ({ submissionId: id }), [id]);
  const gateway = useMemo(() => feedGateway(identity, source), [identity, source]);
  const state = useDiscover(
    gateway,
    postCacheKey(identity, id),
    serverScope(identity.userId, identity.token),
  );
  const item = state.items.find((row) => row.id === id);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/discover'));
  if (!item)
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.message}>
        {state.loading ? (
          <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading photo" />
        ) : (
          <UnavailablePost />
        )}
        {state.error && (
          <>
            <AppText accessibilityRole="alert">We couldn’t load this photo. Try again.</AppText>
            <Button label="Try again" variant="secondary" onPress={() => void state.refresh()} />
          </>
        )}
      </SafeAreaView>
    );
  return (
    <PostDetail
      item={item}
      language={language}
      uri={state.photos[id]}
      photoRevision={state.photoRevision}
      userId={identity.userId}
      token={identity.token}
      reload={() => void state.renew()}
      rate={(score) => void state.rate(id, score)}
      ratingAction={state.ratingAction?.id === id ? state.ratingAction : null}
      ratingDisabled={state.ratingAction?.status === 'saving'}
      blocked={close}
    />
  );
}
const styles = StyleSheet.create({
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
});
