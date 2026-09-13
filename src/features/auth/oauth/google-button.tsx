import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { coordinator, googleLoginUnavailable } from './runtime';
export function useGoogleLogin() {
  return useSyncExternalStore(coordinator.subscribe, coordinator.snapshot, coordinator.snapshot);
}
export function GoogleButton({ disabled = false }: { disabled?: boolean }) {
  const state = useGoogleLogin();
  const unavailable = disabled || state.busy || Boolean(googleLoginUnavailable);
  useEffect(() => () => coordinator.releaseScreen(), []);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ disabled: unavailable, busy: state.busy }}
        disabled={unavailable}
        style={[styles.button, { opacity: unavailable ? 0.6 : 1 }]}
        onPress={() => void coordinator.start()}
      >
        {state.busy ? (
          <ActivityIndicator color="#1F1F1F" />
        ) : (
          <Image
            resizeMode="contain"
            source={require('../../../../assets/images/google-g.png')}
            style={{ width: 20, height: 20 }}
            accessibilityIgnoresInvertColors
          />
        )}
        <AppText style={{ color: '#1F1F1F', fontWeight: '500' }}>Continue with Google</AppText>
      </Pressable>
      {state.busy && (
        <Button
          label="Cancel Google sign-in"
          onPress={() => void coordinator.cancel().catch(() => {})}
        />
      )}
      {googleLoginUnavailable ? <AppText>{googleLoginUnavailable}</AppText> : null}
      {state.message ? <AppText accessibilityLiveRegion="polite">{state.message}</AppText> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    backgroundColor: '#FFFFFF',
    borderColor: '#747775',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
