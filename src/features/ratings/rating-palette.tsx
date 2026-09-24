import type { ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ratingOptions, type RatingScore } from './rating';

const matchIcons: Record<RatingScore, ComponentProps<typeof Ionicons>['name']> = {
  1: 'close',
  2: 'remove',
  3: 'ellipse-outline',
  4: 'checkmark',
  5: 'checkmark-done',
};

export function RatingPalette({
  word,
  selected,
  disabled,
  close,
  choose,
}: {
  word: string;
  selected: RatingScore | null;
  disabled: boolean;
  close: () => void;
  choose: (score: RatingScore) => void;
}) {
  const { colors } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  // Larger text becomes a short vertical list rather than clipping semantic labels.
  const vertical = width < 360 || fontScale > 1.2;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessible={false}
          importantForAccessibility="no"
        />
        <SafeAreaView
          edges={['bottom', 'left', 'right']}
          style={[styles.palette, { backgroundColor: colors.surface }]}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
        >
          <View style={styles.heading}>
            <View style={styles.title}>
              <AppText variant="caption">VOCABULARY MATCH</AppText>
              <AppText variant="heading">{word}</AppText>
            </View>
            <IconButton name="close" label="Close rating" onPress={close} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={`Rate how well the photo represents ${word}`}
              style={[styles.choices, vertical && styles.vertical]}
            >
              {ratingOptions.map(({ score, label }) => {
                const active = score === selected;
                return (
                  <Pressable
                    key={score}
                    accessibilityRole="radio"
                    accessibilityLabel={`${score} — ${label} for ${word}`}
                    accessibilityState={{ checked: active, selected: active, disabled }}
                    disabled={disabled}
                    onPress={() => choose(score)}
                    style={({ pressed }) => [
                      styles.choice,
                      vertical && styles.verticalChoice,
                      {
                        backgroundColor: disabled
                          ? colors.surfaceMuted
                          : active || pressed
                            ? colors.brandSoft
                            : 'transparent',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.symbol,
                        { backgroundColor: active ? colors.brandPrimary : colors.surfaceMuted },
                      ]}
                    >
                      <Ionicons
                        name={matchIcons[score]}
                        size={25}
                        color={active ? colors.textOnPrimary : colors.brandPrimary}
                        accessible={false}
                      />
                    </View>
                    <AppText
                      variant="caption"
                      style={[
                        styles.choiceLabel,
                        vertical && styles.verticalLabel,
                        { color: active ? colors.brandText : colors.textPrimary },
                      ]}
                    >
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', paddingTop: 80 },
  palette: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 12 },
  title: { flex: 1, gap: 4 },
  scroll: { paddingHorizontal: 12, paddingBottom: 16 },
  choices: { flexDirection: 'row', gap: 2 },
  vertical: { flexDirection: 'column', gap: 4 },
  choice: { flex: 1, minHeight: 100, alignItems: 'center', gap: 8, padding: 6, borderRadius: 18 },
  verticalChoice: { flex: 0, flexDirection: 'row', minHeight: 56, paddingHorizontal: 12, gap: 14 },
  symbol: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLabel: { textAlign: 'center', fontWeight: '600' },
  verticalLabel: { textAlign: 'left', flex: 1 },
});
