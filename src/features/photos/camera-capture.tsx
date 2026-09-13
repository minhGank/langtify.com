import { useEffect, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';

export function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (photo: CameraCapturedPicture) => Promise<void>;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null),
    capturing = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  if (!permission)
    return (
      <>
        <ActivityIndicator accessibilityLabel="Checking camera permission" />
        <Button label="Cancel camera" onPress={onCancel} />
      </>
    );
  if (!permission.granted)
    return (
      <>
        <AppText accessibilityRole="header">Camera access needed</AppText>
        <AppText>
          {permission.canAskAgain
            ? 'Allow camera access to photograph your vocabulary challenge. Photos are previewed before you submit.'
            : 'Camera access is disabled. Enable it in your device or browser settings, then return here.'}
        </AppText>
        {permission.canAskAgain ? (
          <Button
            label="Allow camera"
            onPress={() => {
              void requestPermission().catch(() =>
                setError('Camera permission could not be requested. Please try again.'),
              );
            }}
          />
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
        {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
        <Button label="Cancel camera" onPress={onCancel} />
      </>
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
    <>
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
      </View>
      {!ready && <AppText>Starting camera…</AppText>}
      {error ? (
        <>
          <AppText accessibilityRole="alert">{error}</AppText>
          <Button
            label="Restart camera"
            disabled={busy}
            onPress={() => {
              setReady(false);
              setError('');
              setAttempt((value) => value + 1);
            }}
          />
        </>
      ) : null}
      <Button label="Take photo" loading={busy} disabled={!ready} onPress={() => void capture()} />
      <Button label="Cancel camera" disabled={busy} onPress={onCancel} />
    </>
  );
}
const styles = StyleSheet.create({
  camera: { height: 400, borderRadius: 16, overflow: 'hidden', backgroundColor: '#101820' },
});
