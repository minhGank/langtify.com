import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ratingOptions, type RatingAction, type RatingScore, type RatingSummary } from './rating';

export function SemanticRating({
  word,
  summary,
  action,
  disabled,
  onRate,
}: {
  word: string;
  summary: RatingSummary;
  action?: RatingAction | null;
  disabled: boolean;
  onRate: (score: RatingScore) => void;
}) {
  const { colors } = useAppTheme();
  const selected = action?.status === 'saving' ? action.score : summary.viewerRating;
  return (
    <View style={styles.gap}>
      <AppText>
        {summary.ratingCount === 0
          ? 'No semantic ratings yet'
          : `Semantic match: ${summary.averageRating?.toFixed(1)} / 5 · ${summary.ratingCount} ${summary.ratingCount === 1 ? 'rating' : 'ratings'}`}
      </AppText>
      {summary.canRate ? (
        <>
          <AppText>How well does this photo represent “{word}”?</AppText>
          <View style={styles.options}>
            {ratingOptions.map((option) => (
              <Pressable
                key={option.score}
                accessibilityRole="button"
                accessibilityLabel={`${option.score} — ${option.label} for ${word}`}
                accessibilityState={{ selected: selected === option.score, disabled }}
                disabled={disabled}
                onPress={() => onRate(option.score)}
                style={[
                  styles.option,
                  {
                    borderColor: selected === option.score ? colors.primary : colors.border,
                    borderWidth: selected === option.score ? 2 : 1,
                    opacity: disabled ? 0.6 : 1,
                  },
                ]}
              >
                <AppText style={{ textAlign: 'center' }}>
                  {option.score} — {option.label}
                </AppText>
              </Pressable>
            ))}
          </View>
          {summary.viewerRating !== null && (
            <AppText>
              Your rating: {summary.viewerRating} — {ratingOptions[summary.viewerRating - 1].label}
            </AppText>
          )}
          {action?.status === 'saving' && (
            <View style={styles.saving}>
              <ActivityIndicator />
              <AppText>Saving rating: {action.score}…</AppText>
            </View>
          )}
          {action?.status === 'error' && (
            <>
              <AppText accessibilityRole="alert">
                Rating could not be confirmed. Check your current rating or retry.
              </AppText>
              <Button
                label="Retry rating"
                disabled={disabled}
                onPress={() => onRate(action.score)}
              />
            </>
          )}
        </>
      ) : (
        <AppText>Your photo — you cannot rate it.</AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  gap: { gap: 10 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 48,
    flexGrow: 1,
    flexBasis: 90,
    padding: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
