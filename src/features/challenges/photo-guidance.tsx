import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { PhotoGuidance as Guidance } from '@/services/photo-guidance';

export function PhotoGuidance({ guidance, word }: { guidance: Guidance; word: string }) {
  const [expanded, setExpanded] = useState(false);
  const { colors } = useAppTheme();
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Photo idea for ${word}`}
        accessibilityState={{ expanded }}
        accessibilityHint="Show or hide photo ideas, access tips and safety guidance."
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <AppText style={{ color: colors.brandText }}>Photo idea</AppText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.brandText}
          accessible={false}
        />
      </Pressable>
      {expanded && (
        <View style={styles.content}>
          <AppText variant="caption">
            {guidance.mode === 'interpretive'
              ? 'Represent the meaning with a scene'
              : 'Show it in a photo'}
          </AppText>
          <AppText>{guidance.primaryIdea}</AppText>
          {guidance.alternativeIdea && (
            <>
              <AppText variant="caption">
                {guidance.alternativeMode === 'interpretive'
                  ? 'Another idea · interpretive'
                  : 'Another idea'}
              </AppText>
              <AppText>{guidance.alternativeIdea}</AppText>
            </>
          )}
          <AppText variant="caption">Make it work for you</AppText>
          <AppText>{guidance.accessibility}</AppText>
          <AppText variant="caption">Keep it safe</AppText>
          <AppText>{guidance.safety}</AppText>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  toggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  content: { gap: 8 },
});
