import { useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { useAuth } from '@/features/auth/auth-provider';
import { cefrOptions } from '@/features/onboarding/validation';
import { useAppTheme } from '@/hooks/use-app-theme';
import { vocabularyGateway, type Capture } from '@/services/vocabulary';
import { useVocabulary } from './use-vocabulary';

export function VocabularyScreen({ detail = false }: { detail?: boolean }) {
  const { status, session } = useAuth();
  const { conceptId } = useLocalSearchParams<{ conceptId?: string | string[] }>();
  if (status !== 'ready' || !session) return null;
  if (
    detail &&
    (typeof conceptId !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conceptId))
  )
    return (
      <View>
        <AppText>This concept is unavailable.</AppText>
        <Button label="My Vocabulary" onPress={() => router.replace('/vocabulary')} />
      </View>
    );
  return (
    <VocabularyContent
      key={`${session.user.id}:${detail ? conceptId : 'library'}`}
      userId={session.user.id}
      token={session.access_token}
      conceptId={detail && typeof conceptId === 'string' ? conceptId.toLowerCase() : undefined}
    />
  );
}
export function VocabularyContent({
  userId,
  token,
  conceptId,
}: {
  userId: string;
  token: string;
  conceptId?: string;
}) {
  const [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [level, setLevel] = useState('');
  const { colors } = useAppTheme();
  const gateway = useMemo(
    () => ({
      load: (
        cursor: Parameters<ReturnType<typeof vocabularyGateway>['load']>[0],
        signal?: AbortSignal,
      ) =>
        Promise.resolve().then(() =>
          vocabularyGateway(userId, token, { conceptId, search, level }).load(cursor, signal),
        ),
      previews: (ids: string[], signal?: AbortSignal) =>
        Promise.resolve().then(() =>
          vocabularyGateway(userId, token, { conceptId, search, level }).previews(ids, signal),
        ),
    }),
    [userId, token, conceptId, search, level],
  );
  const state = useVocabulary(gateway);
  const listRef = useRef<FlatList<Capture>>(null);
  return (
    <SafeAreaView
      edges={conceptId ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <FlatList
        ref={listRef}
        data={state.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshing={state.loading}
        onRefresh={() => void state.first()}
        ListHeaderComponent={
          <View style={styles.header}>
            <AppText variant="title">{conceptId ? 'Vocabulary history' : 'My Vocabulary'}</AppText>
            {conceptId ? (
              <Button
                label="Back to My Vocabulary"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/vocabulary'))}
              />
            ) : (
              <>
                <FormField
                  label="Search vocabulary"
                  value={input}
                  onChangeText={setInput}
                  maxLength={100}
                  placeholder="Target word or translation"
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (search === input.trim()) void state.first();
                    else setSearch(input.trim());
                  }}
                />
                <Button
                  label="Search"
                  onPress={() => {
                    if (search === input.trim()) void state.first();
                    else setSearch(input.trim());
                  }}
                />
                <View style={styles.filters}>
                  {['', ...cefrOptions.map((option) => option.value)].map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityLabel={value || 'All levels'}
                      accessibilityState={{ selected: level === value }}
                      onPress={() => setLevel(value)}
                      style={[
                        styles.filter,
                        {
                          borderColor: colors.border,
                          backgroundColor: level === value ? colors.surface : colors.background,
                        },
                      ]}
                    >
                      <AppText>
                        {value || 'All levels'}
                        {level === value ? ' ✓' : ''}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {state.data && !conceptId && (
              <AppText>{state.data.totalConcepts} unique concepts learned</AppText>
            )}
            {conceptId && state.data?.concept && (
              <View style={styles.header}>
                <AppText variant="title">{state.data.concept.targetTerm}</AppText>
                <AppText>
                  {state.data.concept.referenceTerm} · {state.data.concept.cefrLevel}
                </AppText>
                <AppText>{state.data.concept.captureCount} captures</AppText>
              </View>
            )}
            {state.loading && !state.data && (
              <ActivityIndicator accessibilityLabel="Loading vocabulary" />
            )}
            {state.error && (
              <>
                <AppText accessibilityRole="alert">Vocabulary could not be loaded.</AppText>
                <Button label="Retry vocabulary" onPress={() => void state.refresh()} />
              </>
            )}
            {state.photoError && (
              <>
                <AppText>Some photos are unavailable or expired.</AppText>
                <Button
                  label="Reload photos"
                  disabled={state.loading}
                  onPress={() => void state.refresh()}
                />
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <CaptureCard
            key={`${item.id}:${state.photoRevision}`}
            capture={item}
            uri={state.photos[item.id] ?? null}
            detail={!!conceptId}
            reload={() => void state.refresh()}
          />
        )}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <AppText>
              {conceptId
                ? state.data?.concept
                  ? 'No more captures. Refresh to see recent changes.'
                  : 'This concept has no saved photos. It may have been deleted.'
                : state.data?.totalConcepts === 0
                  ? 'Complete your first photo challenge to start building your visual vocabulary.'
                  : 'No vocabulary matches this search or page. Try another search or refresh.'}
            </AppText>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.header}>
            {state.data?.hasMore && (
              <Button
                label="Next page"
                disabled={state.loading}
                onPress={() => {
                  void state.next();
                  listRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
              />
            )}
            {state.hasPrevious && (
              <Button
                label="Back to latest"
                disabled={state.loading}
                onPress={() => {
                  void state.first();
                  listRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
              />
            )}
            <Button
              label="Refresh vocabulary"
              disabled={state.loading}
              onPress={() => void state.first()}
            />
          </View>
        }
      />
    </SafeAreaView>
  );
}
function CaptureCard({
  capture,
  uri,
  detail,
  reload,
}: {
  capture: Capture;
  uri: string | null;
  detail: boolean;
  reload: () => void;
}) {
  const { colors } = useAppTheme();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {uri && failed !== uri ? (
        <Image
          key={uri}
          source={{ uri, cache: 'reload' }}
          style={styles.photo}
          accessibilityLabel={`Your photo of ${capture.targetTerm}`}
          onError={() => setFailed(uri)}
        />
      ) : (
        <View style={styles.unavailable}>
          <AppText>Photo unavailable</AppText>
          <Button label="Reload photo" onPress={reload} />
        </View>
      )}
      <AppText accessibilityRole="header">{capture.targetTerm}</AppText>
      <AppText>
        {capture.referenceTerm} · {capture.cefrLevel}
      </AppText>
      {!detail && (
        <AppText>
          {capture.captureCount} {capture.captureCount === 1 ? 'capture' : 'captures'}
        </AppText>
      )}
      <AppText>
        {detail ? 'Submitted' : 'Last captured'}: {new Date(capture.submittedAt).toLocaleString()}
      </AppText>
      <AppText>{capture.visibility === 'public' ? 'Public' : 'Private'}</AppText>
      <Button
        label={detail ? 'Open photo' : `View captures: ${capture.targetTerm}`}
        onPress={() =>
          router.push(
            detail
              ? { pathname: '/photo', params: { assignmentId: capture.assignmentId } }
              : { pathname: '/vocabulary-concept', params: { conceptId: capture.conceptId } },
          )
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    minHeight: 44,
    minWidth: 44,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
  },
  card: { padding: 16, borderWidth: 1, borderRadius: 16, gap: 10 },
  photo: { width: '100%', height: 220, borderRadius: 10 },
  unavailable: { minHeight: 120, justifyContent: 'center', gap: 8 },
});
