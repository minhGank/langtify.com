import { displayTerm } from '@/utils/display-term';
import { TabHeading } from '@/components/ui/tab-heading';
import { useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/auth-provider';
import { cefrOptions } from '@/features/onboarding/validation';
import { serverScope } from '@/lib/server-cache';
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
      <SafeAreaView style={styles.content}>
        <AppText>This word is unavailable.</AppText>
        <Button label="My Vocabulary" onPress={() => router.replace('/vocabulary')} />
      </SafeAreaView>
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
    [level, setLevel] = useState(''),
    [filters, setFilters] = useState(false);
  const { colors } = useAppTheme();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const gateway = useMemo(
    () => ({
      cachedPreviews: (ids: string[]) =>
        vocabularyGateway(userId, token, { conceptId, search, level }).cachedPreviews?.(ids) ?? {},
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
  const state = useVocabulary(
    gateway,
    `${serverScope(userId, token)}:vocabulary:${conceptId ?? ''}:${search}:${level}`,
  );
  const listRef = useRef<FlatList<Capture>>(null);
  return (
    <SafeAreaView
      edges={conceptId ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <FlatList
        ref={listRef}
        accessibilityLabel={conceptId ? 'Vocabulary captures' : 'My vocabulary'}
        data={state.data?.items ?? []}
        numColumns={conceptId ? 1 : 2}
        columnWrapperStyle={!conceptId ? styles.columns : undefined}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={state.loading}
        onRefresh={() => void state.first()}
        ListHeaderComponent={
          <View style={styles.header}>
            {conceptId ? (
              <View style={styles.navigation}>
                <IconButton
                  name="chevron-back"
                  label="Back to My Vocabulary"
                  onPress={() =>
                    router.canGoBack() ? router.back() : router.replace('/vocabulary')
                  }
                />
                <AppText variant="label">Vocabulary history</AppText>
                <View style={styles.headerSpacer} />
              </View>
            ) : (
              <>
                <View style={styles.heading}>
                  <TabHeading title="My Vocabulary" />
                  {state.data && (
                    <AppText variant="caption">
                      {state.data.totalConcepts} {state.data.totalConcepts === 1 ? 'word' : 'words'}{' '}
                      captured
                    </AppText>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Past Words. Add photos to words from earlier challenges."
                  onPress={() => router.push('/past-words')}
                  style={({ pressed }) => [
                    styles.pastWords,
                    { backgroundColor: pressed ? colors.brandSoft : colors.surfaceMuted },
                  ]}
                >
                  <Ionicons
                    name="albums-outline"
                    size={25}
                    color={colors.brandPrimary}
                    accessible={false}
                  />
                  <View style={styles.pastWordsCopy}>
                    <AppText variant="label">Past Words</AppText>
                    <AppText variant="caption">Add a photo to an earlier word</AppText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={colors.brandPrimary}
                    accessible={false}
                  />
                </Pressable>
                <View style={styles.searchRow}>
                  <View
                    style={[
                      styles.search,
                      { borderColor: colors.controlBorder, backgroundColor: colors.surface },
                    ]}
                  >
                    <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                    <TextInput
                      accessibilityLabel="Search vocabulary"
                      value={input}
                      onChangeText={setInput}
                      maxLength={100}
                      placeholder="Search words or translations"
                      placeholderTextColor={colors.textSecondary}
                      style={[styles.searchInput, { color: colors.textPrimary }]}
                      returnKeyType="search"
                      autoCorrect={false}
                      onSubmitEditing={() => {
                        if (search === input.trim()) void state.first();
                        else setSearch(input.trim());
                      }}
                    />
                    {!!input && (
                      <IconButton
                        name="close-circle"
                        label="Clear search"
                        onPress={() => {
                          setInput('');
                          setSearch('');
                        }}
                      />
                    )}
                  </View>
                  <IconButton
                    name="options-outline"
                    label={level ? `Filter level: ${level}` : 'Filter vocabulary'}
                    variant="surface"
                    onPress={() => setFilters(true)}
                  />
                </View>
                {!!level && (
                  <View style={styles.filterStatus}>
                    <AppText variant="caption">Level {level}</AppText>
                    <Button label="Clear filter" variant="ghost" onPress={() => setLevel('')} />
                  </View>
                )}
              </>
            )}
            {conceptId && state.data?.concept && (
              <View style={styles.heading}>
                <AppText variant="title">{displayTerm(state.data.concept.targetTerm)}</AppText>
                <AppText>
                  {displayTerm(state.data.concept.referenceTerm)} · {state.data.concept.cefrLevel}
                </AppText>
                <AppText variant="caption">
                  {state.data.concept.captureCount}{' '}
                  {state.data.concept.captureCount === 1 ? 'capture' : 'captures'}
                </AppText>
              </View>
            )}
            {state.loading && !state.data && (
              <ActivityIndicator
                accessibilityLabel="Loading vocabulary"
                color={colors.brandPrimary}
              />
            )}
            {state.error && (
              <View style={styles.notice}>
                <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                  Vocabulary could not be loaded.
                </AppText>
                <Button
                  label="Retry vocabulary"
                  variant="secondary"
                  onPress={() => void state.refresh()}
                />
              </View>
            )}
            {state.photoError && (
              <View style={styles.notice}>
                <AppText variant="caption">Some photos need to be reloaded.</AppText>
                <Button
                  label="Reload photos"
                  variant="secondary"
                  disabled={state.loading}
                  onPress={() => void state.refresh()}
                />
              </View>
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
            <View style={styles.empty}>
              <Ionicons
                name={input || level ? 'search-outline' : 'images-outline'}
                size={38}
                color={colors.textSecondary}
              />
              <AppText variant="heading">
                {conceptId
                  ? 'No saved photos'
                  : input || level
                    ? 'No matching words'
                    : state.data?.totalConcepts === 0
                      ? 'Your words, in pictures'
                      : 'No words on this page'}
              </AppText>
              <AppText style={[styles.emptyCopy, { color: colors.textSecondary }]}>
                {conceptId
                  ? 'Photos you delete are removed from your history.'
                  : input || level
                    ? 'Try another word or a different level.'
                    : state.data?.totalConcepts === 0
                      ? 'Complete your first photo challenge to start building your visual vocabulary.'
                      : 'Pull down to return to your latest captures.'}
              </AppText>
              {!conceptId && !input && !level && state.data?.totalConcepts === 0 && (
                <Button label="Go to Today" onPress={() => router.navigate('/')} />
              )}
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {state.data?.hasMore && (
              <Button
                label={conceptId ? 'More captures' : 'More words'}
                variant="secondary"
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
                variant="ghost"
                disabled={state.loading}
                onPress={() => {
                  void state.first();
                  listRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
              />
            )}
          </View>
        }
      />
      <Sheet title="Filter by level" visible={filters} onClose={() => setFilters(false)}>
        {[{ value: '', label: 'All levels' }, ...cefrOptions].map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.value || 'All levels'}
            accessibilityState={{ selected: level === option.value }}
            onPress={() => {
              setLevel(option.value);
              setFilters(false);
            }}
            style={[
              styles.filterOption,
              { backgroundColor: level === option.value ? colors.brandSoft : colors.surface },
            ]}
          >
            <AppText variant="label">
              {option.value ? `${option.value} · ${option.label}` : option.label}
            </AppText>
            {level === option.value && (
              <Ionicons name="checkmark" size={22} color={colors.brandPrimary} />
            )}
          </Pressable>
        ))}
      </Sheet>
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
  const open = () =>
    router.push(
      detail
        ? { pathname: '/photo', params: { assignmentId: capture.assignmentId } }
        : { pathname: '/vocabulary-concept', params: { conceptId: capture.conceptId } },
    );
  return (
    <View
      style={[
        styles.card,
        !detail && styles.gridCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${detail ? 'Open photo' : 'View captures'}: ${displayTerm(capture.targetTerm)}. ${displayTerm(capture.referenceTerm)}, ${capture.cefrLevel}. ${detail ? new Date(capture.submittedAt).toLocaleDateString() : `${capture.captureCount} captures`}. ${capture.visibility === 'public' ? 'Public' : 'Private'}.`}
        onPress={open}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
        })}
      >
        <View style={{ backgroundColor: colors.surfaceMuted }}>
          {uri && failed !== uri ? (
            <Image
              key={uri}
              source={{ uri, cache: 'reload' }}
              style={[styles.photo, detail && styles.detailPhoto]}
              accessibilityLabel={`Your photo of ${displayTerm(capture.targetTerm)}`}
              onError={() => setFailed(uri)}
            />
          ) : (
            <View style={styles.unavailable}>
              <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
              <AppText variant="caption">Photo unavailable</AppText>
            </View>
          )}
        </View>
        <View style={styles.caption}>
          <AppText variant={detail ? 'heading' : 'label'} numberOfLines={2}>
            {displayTerm(capture.targetTerm)}
          </AppText>
          <AppText variant="caption" numberOfLines={2}>
            {displayTerm(capture.referenceTerm)} · {capture.cefrLevel}
          </AppText>
          <View style={styles.meta}>
            <AppText variant="caption">
              {detail
                ? new Date(capture.submittedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : `${capture.captureCount} ${capture.captureCount === 1 ? 'capture' : 'captures'}`}
            </AppText>
            <Ionicons
              accessible
              accessibilityLabel={capture.visibility === 'public' ? 'Public' : 'Private'}
              name={capture.visibility === 'public' ? 'globe-outline' : 'lock-closed-outline'}
              size={14}
              color={colors.textSecondary}
            />
          </View>
        </View>
      </Pressable>
      {(!uri || failed === uri) && (
        <View style={styles.reload}>
          <Button label="Reload photo" variant="ghost" onPress={reload} />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: 20,
    gap: 16,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingBottom: 32,
  },
  columns: { gap: 12 },
  header: { gap: 20, paddingBottom: 4 },
  heading: { gap: 6 },
  pastWords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    minHeight: 72,
  },
  pastWordsCopy: { flex: 1, gap: 3 },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerSpacer: { width: 44 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 50,
  },
  searchInput: { flex: 1, fontSize: 15, minHeight: 48, paddingVertical: 10 },
  filterStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterOption: {
    padding: 16,
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, overflow: 'hidden' },
  gridCard: { flex: 1, maxWidth: '50%' },
  photo: { width: '100%', aspectRatio: 1 },
  detailPhoto: { aspectRatio: 4 / 3 },
  unavailable: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  caption: { padding: 12, gap: 4 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 8,
  },
  reload: { paddingHorizontal: 8, paddingBottom: 8 },
  empty: { alignItems: 'center', paddingVertical: 44, gap: 12 },
  emptyCopy: { textAlign: 'center', maxWidth: 320 },
  notice: { gap: 12 },
  footer: { gap: 8 },
});
