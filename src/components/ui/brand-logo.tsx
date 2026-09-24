import { Image, StyleSheet } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export function BrandLogo() {
  const { isDark } = useAppTheme();
  return (
    <Image
      source={
        isDark
          ? require('../../../assets/branding/wordmark-dark.png')
          : require('../../../assets/branding/wordmark-light.png')
      }
      accessible
      accessibilityLabel="Langtify"
      accessibilityRole="image"
      resizeMode="contain"
      style={styles.logo}
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: 232, maxWidth: '100%', aspectRatio: 919 / 251, marginBottom: 12 },
});
