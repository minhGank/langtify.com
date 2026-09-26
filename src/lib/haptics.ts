import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';

type Feedback = 'selection' | 'confirm' | 'success' | 'warning';
function perform(kind: Feedback) {
  // No browser vibration and no delayed feedback when returning from background.
  if (Platform.OS === 'web' || AppState.currentState !== 'active') return;
  try {
    let pending: Promise<void>;
    if (Platform.OS === 'android') {
      pending = Haptics.performAndroidHapticsAsync(
        kind === 'selection'
          ? Haptics.AndroidHaptics.Segment_Tick
          : kind === 'warning'
            ? Haptics.AndroidHaptics.Reject
            : kind === 'success'
              ? Haptics.AndroidHaptics.Confirm
              : Haptics.AndroidHaptics.Virtual_Key,
      );
    } else if (kind === 'selection') pending = Haptics.selectionAsync();
    else if (kind === 'confirm') pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else
      pending = Haptics.notificationAsync(
        kind === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    void pending.catch(() => {});
  } catch {
    // Unsupported hardware/old development binaries never fail the user action.
  }
}

// Call only within already-guarded user action handlers, never cached-data effects.
export const feedback = {
  selection: () => perform('selection'),
  confirm: () => perform('confirm'),
  success: () => perform('success'),
  warning: () => perform('warning'),
};
