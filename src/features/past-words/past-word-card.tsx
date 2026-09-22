import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { PastWord } from '@/services/past-words';
import { displayTerm } from '@/utils/display-term';

export function PastWordCard({ word }: { word: PastWord }) {
  const { colors } = useAppTheme();
  const completed = word.submissionStatus === 'completed',
    deleting = word.submissionStatus === 'deleting',
    pending = word.submissionStatus === 'pending';
  const title = displayTerm(word.targetTerm);
  const label = completed
    ? 'View photos'
    : deleting
      ? 'Manage photo'
      : pending
        ? 'Continue photo'
        : 'Add photo';
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.terms}>
        <AppText variant="heading">{title}</AppText>
        <AppText variant="subtitle">
          {displayTerm(word.referenceTerm)} · {word.cefrLevel}
        </AppText>
      </View>
      <View style={styles.state}>
        <Ionicons
          name={completed ? 'checkmark-circle' : deleting ? 'time-outline' : 'camera-outline'}
          size={18}
          color={completed ? colors.success : colors.muted}
          accessible={false}
        />
        <AppText variant="caption" style={{ flex: 1 }}>
          {completed
            ? 'Captured'
            : deleting
              ? 'Photo deletion in progress'
              : pending
                ? 'Photo in progress'
                : 'No photo yet'}
        </AppText>
        {!word.hasCapture && !deleting && (
          <AppText variant="label" style={{ color: colors.primary }}>
            +10 XP
          </AppText>
        )}
      </View>
      <Button
        label={label}
        accessibilityLabel={`${label}: ${title}`}
        variant={completed || deleting ? 'ghost' : 'secondary'}
        onPress={() =>
          router.push(
            completed
              ? { pathname: '/vocabulary-concept', params: { conceptId: word.conceptId } }
              : {
                  pathname: '/photo',
                  params: {
                    assignmentId: word.assignmentId,
                    captureKind: word.captureKind ?? 'historical',
                    ...(!pending && !deleting ? { capture: '1' } : {}),
                  },
                },
          )
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  terms: { gap: 4 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
