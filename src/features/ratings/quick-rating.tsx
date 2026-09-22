import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ratingOptions, type RatingAction, type RatingScore, type RatingSummary } from './rating';
import { RatingAggregate } from './semantic-rating';
import { RatingPalette } from './rating-palette';

export function QuickRating({
  word,
  summary,
  action,
  disabled,
  onRate,
}: {
  word: string;
  summary: RatingSummary;
  action: RatingAction | null;
  disabled: boolean;
  onRate: (score: RatingScore) => void;
}) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = summary.viewerRating;
  const label = selected === null ? 'Rate match' : ratingOptions[selected - 1].label;
  const saving = action?.status === 'saving';
  return (
    <View style={styles.content}>
      <View style={styles.row}>
        <View style={styles.summary}>
          <RatingAggregate summary={summary} compact />
          {!summary.canRate && <AppText variant="caption">Your photo</AppText>}
        </View>
        {summary.canRate && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              selected === null
                ? `Rate photo: ${word}`
                : `Your rating: ${selected} — ${label}. Edit rating for ${word}`
            }
            accessibilityHint="Choose how well the photo matches the word."
            accessibilityState={{ expanded: open, disabled: disabled || saving, busy: saving }}
            disabled={disabled || saving}
            onPress={() => setOpen(true)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected === null ? colors.surfaceMuted : colors.primarySoft,
                opacity: disabled || pressed ? 0.6 : 1,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Ionicons
                name={selected === null ? 'scan-outline' : 'checkmark-circle'}
                color={colors.primary}
                size={20}
                accessible={false}
              />
            )}
            <AppText variant="label" style={[styles.label, { color: colors.primary }]}>
              {saving ? 'Saving…' : label}
            </AppText>
            {!saving && (
              <Ionicons name="chevron-down" color={colors.primary} size={14} accessible={false} />
            )}
          </Pressable>
        )}
      </View>
      {action?.status === 'error' && (
        <AppText accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
          Rating not confirmed. Tap to check or change it.
        </AppText>
      )}
      {open && summary.canRate && (
        <RatingPalette
          word={word}
          selected={selected}
          disabled={disabled || saving}
          close={() => setOpen(false)}
          choose={(score) => {
            setOpen(false);
            // The chip changes only after the authoritative acknowledgement.
            if (score !== selected) onRate(score);
          }}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  summary: { gap: 4, flexShrink: 1 },
  chip: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  label: { flexShrink: 1 },
});
