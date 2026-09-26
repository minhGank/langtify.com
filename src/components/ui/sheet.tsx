import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

type SheetProps = PropsWithChildren<{
  title: string;
  visible: boolean;
  onClose: () => void;
  scroll?: boolean;
}>;

export function Sheet({ title, visible, onClose, children, scroll = true }: SheetProps) {
  const { colors } = useAppTheme();
  const reduced = useReducedMotion();
  const nativeSheet = Platform.OS === 'ios';

  return (
    <Modal
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      transparent={!nativeSheet}
      presentationStyle={nativeSheet ? 'pageSheet' : 'overFullScreen'}
      allowSwipeDismissal={nativeSheet}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={nativeSheet ? 'padding' : undefined}
        style={[styles.container, !nativeSheet && { backgroundColor: colors.overlay }]}
      >
        {!nativeSheet && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessible={false}
            importantForAccessibility="no"
          />
        )}
        <SafeAreaView
          edges={['bottom', 'left', 'right']}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            nativeSheet ? styles.nativeSheet : styles.bottomSheet,
            !nativeSheet && !scroll && styles.listSheet,
            { backgroundColor: colors.surface },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <AppText variant="heading" style={styles.title}>
              {title}
            </AppText>
            <IconButton name="close" label={`Close ${title}`} onPress={onClose} variant="surface" />
          </View>
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={nativeSheet ? 'interactive' : 'on-drag'}
              contentContainerStyle={styles.content}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.content, styles.listContent]}>{children}</View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden' },
  nativeSheet: { flex: 1 },
  bottomSheet: { maxHeight: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  listSheet: { height: '90%' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: { flex: 1 },
  content: { padding: 20, gap: 16 },
  listContent: { flex: 1, minHeight: 0 },
});
