import type { ErrorBoundaryProps } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';

// A route error may contain provider details or URLs. Never render its message,
// stack or route parameters. This fallback must also work outside AuthProvider.
export function AppErrorBoundary({ retry }: ErrorBoundaryProps) {
  const [busy, setBusy] = useState(false);
  const retrying = useRef(false);
  async function tryAgain() {
    if (retrying.current) return;
    retrying.current = true;
    setBusy(true);
    try {
      await retry();
    } catch {
      // Keep the same safe recovery guidance if retry itself fails.
    } finally {
      retrying.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <View style={styles.content}>
        <AppText variant="title">We couldn’t open this screen</AppText>
        <AppText>Try again. If this keeps happening, close and reopen Langtify.</AppText>
        <Button label="Try again" loading={busy} onPress={() => void tryAgain()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 20 },
});
