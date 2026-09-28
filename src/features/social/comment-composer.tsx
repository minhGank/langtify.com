import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

export function CommentComposer({
  value,
  change,
  send,
  busy,
  retry,
  error,
}: {
  value: string;
  change: (value: string) => void;
  send: () => void;
  busy: boolean;
  retry: boolean;
  error: string | null;
}) {
  const { colors } = useAppTheme();
  const count = [...value].length;
  const disabled = busy || !value.trim() || [...value.trim()].length > 500;
  return (
    <View style={styles.content}>
      {error && (
        <AppText variant="caption" accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </AppText>
      )}
      <View
        style={[
          styles.composer,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.controlBorder },
        ]}
      >
        <TextInput
          accessibilityLabel="Add a comment"
          accessibilityHint="Up to 500 characters."
          placeholder="Add a comment…"
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.brandPrimary}
          value={value}
          onChangeText={change}
          multiline
          maxLength={500}
          editable={!busy}
          autoCapitalize="sentences"
          autoComplete="off"
          submitBehavior="newline"
          underlineColorAndroid="transparent"
          style={[styles.input, { color: colors.textPrimary }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Sending comment' : retry ? 'Retry comment' : 'Send comment'}
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          onPress={send}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: disabled
                ? colors.surfaceMuted
                : pressed
                  ? colors.brandPrimaryPressed
                  : colors.brandPrimary,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={23}
              color={disabled ? colors.textSecondary : colors.textOnPrimary}
              accessible={false}
            />
          )}
        </Pressable>
      </View>
      {count >= 450 && (
        <AppText variant="caption" style={styles.counter}>
          {count} / 500
        </AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderRadius: 26,
    padding: 4,
    paddingLeft: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 144,
    fontSize: 16,
    lineHeight: 23,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  counter: { textAlign: 'right', paddingRight: 12 },
});
