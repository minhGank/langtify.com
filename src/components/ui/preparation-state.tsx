import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { MotionView } from './motion-view';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { selectLanguageFact } from '@/data/language-facts';

// On web, random editorial text enters the tree only after hydration. Native
// renders reserve the chosen text's natural height from their very first layout.
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Mount only for a real initial/setup wait; unmount immediately on completion or
// error. This timer reveals optional copy, never delays or initiates a request.
export function PreparationState({ title, label }: { title: string; label: string }) {
  const { colors } = useAppTheme();
  const reduced = useReducedMotion();
  const [fact] = useState(() => selectLanguageFact(Math.random()));
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        style={styles.status}
      >
        <View
          style={styles.indicator}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {reduced ? (
            <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
          ) : (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          )}
        </View>
        <AppText variant="heading" style={styles.center}>
          {title}
        </AppText>
      </View>
      <View
        style={[styles.factSpace, !revealed && styles.hidden]}
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
      >
        <MotionView trigger={revealed ? fact.id : null} style={styles.fact}>
          {hydrated && (
            <View style={styles.fact}>
              <AppText variant="caption" style={styles.center}>
                While you wait
              </AppText>
              <AppText style={[styles.center, { color: colors.textSecondary }]}>
                {fact.text}
              </AppText>
            </View>
          )}
        </MotionView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    minHeight: 300,
    paddingVertical: 32,
    gap: 32,
  },
  status: { alignItems: 'center', gap: 16, maxWidth: 360, width: '100%' },
  indicator: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  factSpace: { minHeight: 132, width: '100%', maxWidth: 340 },
  fact: { gap: 8 },
  hidden: { opacity: 0 },
  center: { textAlign: 'center' },
});
