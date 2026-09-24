import { displayTerm } from '@/utils/display-term';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { FeedItem } from '@/services/discover';
import type { RatingAction, RatingScore } from '@/features/ratings/rating';
import { FeedPhoto } from './feed-photo';
import { QuickRating } from '@/features/ratings/quick-rating';

export function FeedCard({
  item,
  language,
  uri,
  photoRevision,
  reload,
  open,
  author,
  ratingAction,
  ratingDisabled,
  rate,
}: {
  item: FeedItem;
  language: string;
  uri?: string;
  photoRevision: number;
  reload: () => void;
  open: () => void;
  author: () => void;
  ratingAction: RatingAction | null;
  ratingDisabled: boolean;
  rate: (score: RatingScore) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <FeedPhoto
        key={`${item.id}:${photoRevision}`}
        uri={uri}
        word={displayTerm(item.targetTerm)}
        reload={reload}
        open={open}
      />
      <View style={styles.body}>
        <View style={styles.row}>
          <AppText variant="caption" style={{ color: colors.textSecondary }}>
            {language}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${displayTerm(item.targetTerm)}`}
          onPress={open}
        >
          <AppText variant="heading" style={styles.word}>
            {displayTerm(item.targetTerm)}
          </AppText>
          <AppText style={{ color: colors.textSecondary }}>
            {displayTerm(item.referenceTerm)}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View @${item.username}`}
          onPress={author}
          style={styles.author}
        >
          <AppText variant="caption">Photo by @{item.username}</AppText>
        </Pressable>
        <View style={[styles.ratingRow, { borderTopColor: colors.border }]}>
          <QuickRating
            word={displayTerm(item.targetTerm)}
            summary={item}
            action={ratingAction}
            disabled={ratingDisabled}
            onRate={rate}
          />
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  body: { padding: 18, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  word: { fontSize: 27, lineHeight: 34 },
  author: { minHeight: 44, justifyContent: 'center', marginVertical: -6 },
  ratingRow: {
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
  },
  summary: { gap: 3, flexShrink: 1 },
  rate: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
