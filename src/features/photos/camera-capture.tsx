import { useCallback, useEffect, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/hooks/use-app-theme';

// Mounted only after the learner explicitly chooses to take/retake a photo.
export function CameraCapture({
  onCapture,
  onCancel,
  onChooseLibrary,
}: {
  onCapture: (photo: CameraCapturedPicture) => Promise<void>;
  onCancel: () => void;
  onChooseLibrary?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const { colors } = useAppTheme();
  const camera = useRef<CameraView | null>(null),
    capturing = useRef(false),
    alive = useRef(true),
    asked = useRef(false);
  const [asking, setAsking] = useState(false);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const askPermission = useCallback(async () => {
    setAsking(true);
    setError('');
    try {
      await requestPermission();
    } catch {
      if (alive.current) setError('Camera permission could not be requested. Please try again.');
    } finally {
      if (alive.current) setAsking(false);
    }
  }, [requestPermission]);
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      void askPermission();
    }
  }, [permission, askPermission]);
  if (!permission || asking)
    return (
      <View style={styles.permission}>
        <ActivityIndicator accessibilityLabel="Checking camera permission" color={colors.primary} />
        <Button label="Cancel camera" variant="ghost" onPress={onCancel} />
      </View>
    );
  if (!permission.granted)
    return (
      <View style={styles.permission}>
        <Ionicons name="camera-outline" size={40} color={colors.muted} />
        <AppText variant="heading">Camera access needed</AppText>
        <AppText style={styles.center}>
          {permission.canAskAgain
            ? 'Allow camera access to capture this word.'
            : 'Enable camera access in Settings, then return here.'}
        </AppText>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void askPermission()} />
        ) : Platform.OS !== 'web' ? (
          <Button
            label="Open settings"
            onPress={() => {
              void Linking.openSettings().catch(() =>
                setError('Open your device settings to allow camera access.'),
              );
            }}
          />
        ) : null}
        {error ? (
          <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}
        {onChooseLibrary && (
          <Button label="Choose from library" variant="secondary" onPress={onChooseLibrary} />
        )}
        <Button label="Cancel camera" variant="ghost" onPress={onCancel} />
      </View>
    );
  const capture = async () => {
    if (!ready || capturing.current || !camera.current) return;
    capturing.current = true;
    setBusy(true);
    setError('');
    try {
      const photo = await camera.current.takePictureAsync({
        exif: false,
        quality: 1,
        skipProcessing: false,
      });
      if (!photo) throw new Error('capture_failed');
      if (!alive.current) {
        if (Platform.OS !== 'web') {
          const file = new File(photo.uri);
          if (file.exists) file.delete();
        }
        return;
      }
      await onCapture(photo);
    } catch {
      if (alive.current) setError('The photo could not be captured or prepared. Please try again.');
    } finally {
      capturing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View style={styles.capture}>
      <View style={styles.camera}>
        <CameraView
          key={attempt}
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            setReady(false);
            setError('The camera could not start. Check camera access and try again.');
          }}
        />
        {!ready && (
          <ActivityIndicator
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Starting camera"
            color="#FFFFFF"
          />
        )}
      </View>
      {error ? (
        <View style={styles.error}>
          <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
            {error}
          </AppText>
          {!ready && (
            <Button
              label="Restart camera"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setReady(false);
                setError('');
                setAttempt((value) => value + 1);
              }}
            />
          )}
        </View>
      ) : null}
      <View style={styles.controls}>
        <View style={styles.side}>
          <Button
            label="Cancel"
            accessibilityLabel="Cancel camera"
            variant="ghost"
            disabled={busy}
            onPress={onCancel}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: !ready || busy, busy }}
          disabled={!ready || busy}
          onPress={() => void capture()}
          style={({ pressed }) => [
            styles.shutter,
            { borderColor: colors.text, opacity: !ready || busy || pressed ? 0.45 : 1 },
          ]}
        >
          <View style={[styles.shutterInner, { backgroundColor: colors.text }]}>
            {busy && <ActivityIndicator color={colors.background} />}
          </View>
        </Pressable>
        <View style={styles.side}>
          {onChooseLibrary && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onChooseLibrary}
              style={({ pressed }) => [styles.library, { opacity: pressed || busy ? 0.5 : 1 }]}
            >
              <Ionicons name="images-outline" size={26} color={colors.text} />
              <AppText variant="caption" style={styles.center}>
                Photo library
              </AppText>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  capture: { gap: 16 },
  camera: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 440,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#101820',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  side: { flex: 1 },
  library: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 4 },
  shutter: { width: 76, height: 76, borderWidth: 3, borderRadius: 38, padding: 5 },
  shutterInner: { flex: 1, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  permission: { minHeight: 300, justifyContent: 'center', alignItems: 'center', gap: 20 },
  center: { textAlign: 'center' },
  error: { gap: 8 },
});
