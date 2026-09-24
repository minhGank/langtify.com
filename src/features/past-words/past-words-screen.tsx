import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/auth-provider';
import { cefrOptions, type CefrLevel } from '@/features/onboarding/validation';
import { useAppTheme } from '@/hooks/use-app-theme';
import { serverScope } from '@/lib/server-cache';
import type { PastWordsIdentity } from '@/services/past-words';
import { PastWordsResults } from './past-words-results';

export function PastWordsScreen() {
  const { status, session, account } = useAuth();
  const identity = useMemo(
    () =>
      session && account?.learning
        ? {
            userId: session.user.id,
            token: session.access_token,
            timezone: account.learning.timezone,
          }
        : null,
    [session, account],
  );
  if (status !== 'ready' || !identity) return null;
  return (
    <PastWordsContent
      key={`${serverScope(identity.userId, identity.token)}:${identity.timezone}`}
      identity={identity}
    />
  );
}

function PastWordsContent({ identity }: { identity: PastWordsIdentity }) {
  const { colors } = useAppTheme();
  const [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [level, setLevel] = useState<CefrLevel | ''>(''),
    [filters, setFilters] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const query = useMemo(() => ({ search, level }), [search, level]);
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerLeft: router.canGoBack()
            ? undefined
            : () => (
                <IconButton
                  name="chevron-back"
                  label="Back to Vocabulary"
                  onPress={() => router.replace('/vocabulary')}
                />
              ),
        }}
      />
      <View style={styles.header}>
        <AppText variant="subtitle">Give words from earlier challenges a picture.</AppText>
        <View style={styles.searchRow}>
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
              size={20}
              color={colors.textSecondary}
              accessible={false}
            />
            <TextInput
              accessibilityLabel="Search past words"
              placeholder="Search words or translations"
              selectionColor={colors.brandPrimary}
              placeholderTextColor={colors.textSecondary}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => setSearch(input.trim())}
              maxLength={64}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.input, { color: colors.textPrimary }]}
            />
            {!!input && (
              <IconButton
                name="close-circle"
                label="Clear past words search"
                onPress={() => {
                  setInput('');
                  setSearch('');
                }}
              />
            )}
          </View>
          <IconButton
            name="options-outline"
            label={level ? `Filter past words: ${level}` : 'Filter past words'}
            variant="surface"
            onPress={() => setFilters(true)}
          />
        </View>
        {!!level && (
          <View style={styles.filterStatus}>
            <AppText variant="caption">Level {level}</AppText>
            <Button label="Clear level filter" variant="ghost" onPress={() => setLevel('')} />
          </View>
        )}
      </View>
      <PastWordsResults key={`${search}:${level}`} identity={identity} query={query} />
      <Sheet title="Filter by level" visible={filters} onClose={() => setFilters(false)}>
        {[{ value: '' as const, label: 'All levels' }, ...cefrOptions].map((option) => (
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
              <Ionicons name="checkmark" size={22} color={colors.brandPrimary} accessible={false} />
            )}
          </Pressable>
        ))}
      </Sheet>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    borderRadius: 16,
  },
  input: { flex: 1, minHeight: 52, fontSize: 15, paddingVertical: 12 },
  filterStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterOption: {
    minHeight: 52,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
