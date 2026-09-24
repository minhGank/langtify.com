import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { nativeBackFallback } from '@/components/ui/native-back';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { serverScope } from '@/lib/server-cache';
import type { ExploreIdentity } from '@/services/explore';
import { PeopleResults } from './people-results';
import { SearchEmpty } from './search-results';
import { WordResults } from './word-results';

type Category = 'words' | 'people';
export function ExploreScreen({ initialCategory = 'words' }: { initialCategory?: Category }) {
  const { session, account, status } = useAuth();
  const identity = useMemo(
    () =>
      session && account?.learning
        ? {
            userId: session.user.id,
            token: session.access_token,
            targetLanguageId: account.learning.target_language_id,
            referenceLanguageId: account.learning.reference_language_id,
          }
        : null,
    [session, account],
  );
  if (status !== 'ready' || !identity) return null;
  const language =
    account?.languages.find((item) => item.id === identity.targetLanguageId)?.name ??
    'your learning language';
  return (
    <ExploreContent
      key={`${serverScope(identity.userId, identity.token)}:${identity.targetLanguageId}:${identity.referenceLanguageId}`}
      identity={identity}
      language={language}
      initialCategory={initialCategory}
    />
  );
}
function ExploreContent({
  identity,
  language,
  initialCategory,
}: {
  identity: ExploreIdentity;
  language: string;
  initialCategory: Category;
}) {
  const { colors } = useAppTheme();
  const [category, setCategory] = useState(initialCategory),
    [input, setInput] = useState(''),
    [settled, setSettled] = useState('');
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(normalized), 350);
    return () => clearTimeout(timer);
  }, [normalized]);
  const valid =
    category === 'people'
      ? /^[a-z0-9][a-z0-9_]{1,29}$/.test(normalized)
      : /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s'’\-]{1,63}$/u.test(normalized);
  const ready = normalized === settled && valid;
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ headerLeft: nativeBackFallback() }} />
      <View style={styles.header}>
        <View
          style={[
            styles.search,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.controlBorder,
              borderWidth: 1,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={21}
            color={colors.textSecondary}
            accessible={false}
          />
          <TextInput
            accessibilityLabel={category === 'words' ? 'Search vocabulary' : 'Search usernames'}
            placeholder={category === 'words' ? `Search ${language} words` : 'Search usernames'}
            selectionColor={colors.brandPrimary}
            placeholderTextColor={colors.textSecondary}
            value={input}
            onChangeText={setInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            maxLength={category === 'words' ? 64 : 30}
            style={[styles.input, { color: colors.textPrimary }]}
          />
          {!!input && (
            <IconButton
              name="close-circle"
              label="Clear search"
              onPress={() => {
                setInput('');
                setSettled('');
              }}
            />
          )}
        </View>
        <View
          accessibilityRole="tablist"
          style={[styles.segments, { backgroundColor: colors.surfaceMuted }]}
        >
          {(['words', 'people'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={value === 'words' ? 'Words' : 'People'}
              accessibilityState={{ selected: category === value }}
              onPress={() => setCategory(value)}
              style={[styles.segment, category === value && { backgroundColor: colors.surface }]}
            >
              <Ionicons
                name={
                  value === 'words'
                    ? category === value
                      ? 'book'
                      : 'book-outline'
                    : category === value
                      ? 'people'
                      : 'people-outline'
                }
                size={18}
                color={category === value ? colors.brandText : colors.textSecondary}
                accessible={false}
              />
              <AppText
                variant="label"
                style={{ color: category === value ? colors.brandText : colors.textSecondary }}
              >
                {value === 'words' ? 'Words' : 'People'}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>
      {ready ? (
        category === 'words' ? (
          <WordResults key={`words:${settled}`} identity={identity} query={settled} />
        ) : (
          <PeopleResults key={`people:${settled}`} identity={identity} query={settled} />
        )
      ) : (
        <SearchEmpty
          loading={valid && normalized !== settled}
          title={
            category === 'words' ? 'Find a word. See it in real life.' : 'Find your fellow learners'
          }
          hint={
            category === 'words'
              ? 'Search with at least 2 characters.'
              : 'Enter at least 2 characters of a username.'
          }
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 16 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    borderRadius: 16,
  },
  input: { flex: 1, minHeight: 52, fontSize: 16, paddingVertical: 12 },
  segments: { flexDirection: 'row', padding: 4, borderRadius: 14, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
  },
});
