import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useSearchActive } from '@/features/explore/use-search-active';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { serverScope } from '@/lib/server-cache';
import {
  pastWordsGateway,
  PastWordsUnavailable,
  type PastWord,
  type PastWordsIdentity,
  type PastWordsQuery,
} from '@/services/past-words';
import { pastWordsCache, pastWordsWindow } from './cache';
import { PastWordCard } from './past-word-card';

// This is presentation of the server's calendar date, never a device-derived
// eligibility calculation. UTC keeps the printed date identical in every zone.
export function pastWordDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export function PastWordsResults({
  identity,
  query: filters,
}: {
  identity: PastWordsIdentity;
  query: PastWordsQuery;
}) {
  const { colors } = useAppTheme();
  const active = useSearchActive();
  const list = useRef<FlatList<PastWord>>(null);
  const gateway = useMemo(() => pastWordsGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      pastWordsCache.entry(
        `${serverScope(identity.userId, identity.token)}:past-words:${identity.timezone}:${filters.search}:${filters.level}`,
        ['past-words', 'vocabulary'],
      ),
    [identity, filters],
  );
  const load = useCallback(
    async (signal: AbortSignal) => pastWordsWindow(await gateway.load(filters, null, signal)),
    [gateway, filters],
  );
  const discardOnError = useCallback((cause: unknown) => cause instanceof PastWordsUnavailable, []);
  const query = useServerQuery(entry, load, { staleTime: Infinity, discardOnError });
  const refresh = () => {
    if (!active.current || entry.getSnapshot().loading || entry.getSnapshot().retired) return;
    const pending = query.refresh(),
      revision = entry.getRevision();
    void pending.then(() => {
      const saved = entry.getSnapshot();
      if (
        active.current &&
        entry.getRevision() === revision &&
        !saved.error &&
        !saved.loading &&
        !saved.retired &&
        saved.data?.fromStart
      )
        list.current?.scrollToOffset({ offset: 0, animated: false });
    });
  };
  const more = () => {
    const snapshot = entry.getSnapshot(),
      saved = snapshot.data;
    if (!active.current || snapshot.retired || snapshot.loading || !saved?.hasMore) return;
    void entry.read(
      async (signal) => {
        const page = await gateway.load(filters, saved.cursor, signal),
          last = page.items.at(-1);
        const merged = Array.from(
          new Map(
            [...saved.items, ...page.items].map((item) => [item.assignmentId, item]),
          ).values(),
        );
        return {
          ...page,
          items: merged.slice(-40),
          fromStart: saved.fromStart && merged.length <= 40,
          cursor: last
            ? { captured: last.hasCapture, date: last.challengeDate, id: last.assignmentId }
            : saved.cursor,
        };
      },
      { staleTime: Infinity, force: true, discardOnError },
    );
  };
  const items = query.data?.items ?? [];
  const filtered = !!filters.search || !!filters.level;
  return (
    <FlatList
      ref={list}
      accessibilityLabel="Past words"
      data={items}
      keyExtractor={(item) => item.assignmentId}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      refreshing={query.loading && !!query.data}
      onRefresh={refresh}
      renderItem={({ item, index }) => {
        const previous = items[index - 1],
          section = !previous || previous.hasCapture !== item.hasCapture;
        return (
          <View style={styles.group}>
            {section && (
              <AppText variant="heading" style={styles.section}>
                {item.hasCapture ? 'Captured' : 'Still to capture'}
              </AppText>
            )}
            {(section || previous.challengeDate !== item.challengeDate) && (
              <AppText variant="caption" accessibilityRole="header">
                {pastWordDate(item.challengeDate)}
              </AppText>
            )}
            <PastWordCard word={item} />
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          {query.loading ? (
            <ActivityIndicator accessibilityLabel="Loading past words" color={colors.primary} />
          ) : (
            <>
              <Ionicons
                name={filtered ? 'search-outline' : 'albums-outline'}
                size={36}
                color={colors.muted}
                accessible={false}
              />
              <AppText variant="heading">
                {query.error
                  ? 'Past words unavailable'
                  : filtered
                    ? 'No matching words'
                    : 'More words to revisit soon'}
              </AppText>
              <AppText variant="subtitle" style={styles.center}>
                {query.error
                  ? 'Your words are safe. Try again when you’re connected.'
                  : filtered
                    ? 'Try another word or a different level.'
                    : 'Words from previous challenges will appear here, ready for a photo.'}
              </AppText>
            </>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {query.error && (
            <>
              {!!items.length && (
                <AppText accessibilityRole="alert">Past words could not be updated.</AppText>
              )}
              <Button label="Retry past words" variant="secondary" onPress={refresh} />
            </>
          )}
          {!query.error && query.data?.hasMore && (
            <Button
              label="More past words"
              variant="secondary"
              disabled={query.loading}
              onPress={more}
            />
          )}
          {query.data && !query.data.fromStart && (
            <Button
              label="Back to newest words"
              variant="ghost"
              disabled={query.loading}
              onPress={refresh}
            />
          )}
        </View>
      }
    />
  );
}
const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexGrow: 1,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  group: { gap: 10, marginBottom: 12 },
  section: { paddingTop: 12, paddingBottom: 2 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 12 },
  center: { textAlign: 'center' },
  footer: { gap: 12, paddingTop: 12 },
});
