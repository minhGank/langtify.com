import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { useAppTheme } from '@/hooks/use-app-theme';

export function Avatar({
  username,
  uri,
  size = 48,
}: {
  username: string;
  uri?: string | null;
  size?: number;
}) {
  const { colors } = useAppTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const fontSize = Math.round(size * 0.38);
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft },
      ]}
    >
      {uri && failedUri !== uri ? (
        <Image
          key={uri}
          source={{ uri, cache: 'reload' }}
          accessibilityLabel={`${username}'s avatar`}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <AppText
          variant="label"
          accessibilityLabel={`${username || 'Langtify'}'s avatar`}
          // This initial is artwork inside a fixed circular mask. Its accessible
          // label remains available independently of the decorative text size.
          allowFontScaling={false}
          style={[
            styles.initial,
            { color: colors.primary, fontSize, lineHeight: Math.ceil(fontSize * 1.25) },
          ]}
        >
          {username.slice(0, 1).toUpperCase() || 'L'}
        </AppText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initial: { includeFontPadding: false, textAlign: 'center' },
});
