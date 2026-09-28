import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/use-app-theme';

export function PostLayout({
  children,
  composer,
  hidden = false,
}: {
  children: ReactNode;
  composer?: ReactNode;
  hidden?: boolean;
}) {
  const { colors } = useAppTheme();
  const frame = useRef<View>(null);
  const [top, setTop] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <View
      ref={frame}
      style={styles.fill}
      onLayout={() => {
        frame.current?.measureInWindow((_x, y) => setTop(y));
      }}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={top}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      >
        <ScrollView
          style={styles.fill}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={styles.content}
        >
          {children}
        </ScrollView>
        {composer && (
          <SafeAreaView
            edges={keyboardVisible ? ['left', 'right'] : ['left', 'right', 'bottom']}
            style={{ backgroundColor: colors.surface }}
          >
            <View style={[styles.composer, { borderColor: colors.border }]}>{composer}</View>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 28 },
  composer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
