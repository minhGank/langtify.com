import { useEffect, useRef, type PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/hooks/use-app-theme';

export function Screen({
  children,
  hasTabBar = false,
  onRefresh,
  refreshing = false,
  scrollResetKey,
}: PropsWithChildren<{
  hasTabBar?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  scrollResetKey?: string | number;
}>) {
  const { colors } = useAppTheme();
  const scroll = useRef<ScrollView>(null);
  const previous = useRef(scrollResetKey);
  useEffect(() => {
    if (previous.current !== scrollResetKey) {
      previous.current = scrollResetKey;
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  }, [scrollResetKey]);
  return (
    <SafeAreaView
      edges={hasTabBar ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.brandPrimary}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 24,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
});
