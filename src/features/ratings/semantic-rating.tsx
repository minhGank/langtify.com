import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ratingOptions, type RatingAction, type RatingScore, type RatingSummary } from './rating';

export function RatingAggregate({
  summary,
  compact = false,
}: {
  summary: RatingSummary;
  compact?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <AppText variant={compact ? 'caption' : 'body'} style={{ color: colors.textSecondary }}>
      {summary.ratingCount === 0
        ? 'No ratings yet'
        : `${summary.averageRating?.toFixed(1)} / 5 · ${summary.ratingCount} ${summary.ratingCount === 1 ? 'rating' : 'ratings'}`}
    </AppText>
  );
}
export function SemanticRating({
  word,
  summary,
  action,
  disabled,
  onRate,
  compact = false,
}: {
  word: string;
  summary: RatingSummary;
  action?: RatingAction | null;
  disabled: boolean;
  onRate: (score: RatingScore) => void;
  compact?: boolean;
}) {
  const { colors } = useAppTheme();
  const selected = action?.status === 'saving' ? action.score : summary.viewerRating;
  return (
    <View style={styles.gap}>
      {!compact && (
        <View style={styles.heading}>
          <AppText variant="heading">Vocabulary match</AppText>
          <RatingAggregate summary={summary} />
        </View>
      )}
      {summary.canRate ? (
        <>
          <AppText>How well does this photo represent “{word}”?</AppText>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={`Rate how well the photo represents ${word}`}
            style={styles.options}
          >
            {ratingOptions.map((option) => {
              const active = selected === option.score;
              return (
                <Pressable
                  key={option.score}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.score} — ${option.label} for ${word}`}
                  accessibilityState={{ checked: active, selected: active, disabled }}
                  disabled={disabled}
                  onPress={() => onRate(option.score)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: disabled
                        ? colors.surfaceMuted
                        : active || pressed
                          ? colors.brandSoft
                          : colors.surface,
                      borderColor: active ? colors.brandPrimary : colors.controlBorder,
                    },
                  ]}
                >
                  <AppText
                    variant="label"
                    style={{ color: active ? colors.brandText : colors.textPrimary, flexShrink: 1 }}
                  >
                    {option.label}
                  </AppText>
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={active ? colors.brandPrimary : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>
          <View accessibilityLiveRegion="polite">
            {action?.status === 'saving' ? (
              <View style={styles.saving}>
                <ActivityIndicator color={colors.brandPrimary} />
                <AppText variant="caption">Saving your rating…</AppText>
              </View>
            ) : summary.viewerRating !== null ? (
              <>
                <AppText variant="label" style={{ color: colors.brandText }}>
                  Your rating: {ratingOptions[summary.viewerRating - 1].label}
                </AppText>
                <AppText variant="caption">Tap another match to change it.</AppText>
              </>
            ) : (
              <AppText variant="caption">Tap a match to rate this photo.</AppText>
            )}
          </View>
          {action?.status === 'error' && (
            <>
              <AppText accessibilityRole="alert" style={{ color: colors.error }}>
                Your rating couldn’t be confirmed. Check it before retrying.
              </AppText>
              <Button
                label="Retry rating"
                variant="secondary"
                disabled={disabled}
                onPress={() => onRate(action.score)}
              />
            </>
          )}
        </>
      ) : (
        <AppText variant="caption">Your photo — you cannot rate it.</AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  gap: { gap: 16 },
  heading: { gap: 4 },
  options: { gap: 8 },
  option: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
