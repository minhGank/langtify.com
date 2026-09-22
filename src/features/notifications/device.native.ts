import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import type { Installation, PushPermission } from './model';
const key = 'langtify.push.installation.v1';
export const devicePlatform = Platform.OS === 'android' ? 'android' : 'ios';
const iosPushDisabled = () =>
  Platform.OS === 'ios' && Constants.expoConfig?.extra?.langtifyDisableIosPush === true;
export async function permission(request = false): Promise<PushPermission> {
  if (iosPushDisabled() || !Device.isDevice) return 'unavailable';
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('learning', {
      name: 'Daily learning',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let result = await Notifications.getPermissionsAsync();
  if (request && result.status === 'undetermined' && result.canAskAgain)
    result = await Notifications.requestPermissionsAsync();
  return result.status;
}
export async function pushToken(): Promise<string | null> {
  if (iosPushDisabled()) return null;
  const projectId: unknown =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.easConfig?.projectId;
  if (
    typeof projectId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)
  )
    return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
export async function loadInstallation(): Promise<Installation> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) {
    const value = {
      id: Crypto.randomUUID(),
      secret: Array.from(Crypto.getRandomBytes(32), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
      revision: 0,
    };
    await saveInstallation(value);
    return value;
  }
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !('secret' in value) ||
    !('revision' in value) ||
    typeof value.id !== 'string' ||
    typeof value.secret !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.secret) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('Secure notification registration needs recovery.');
  return { id: value.id, secret: value.secret, revision: value.revision };
}
export async function saveInstallation(value: Installation) {
  await SecureStore.setItemAsync(key, JSON.stringify(value), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
export async function clearResponses() {
  await Notifications.clearLastNotificationResponseAsync();
  await Notifications.dismissAllNotificationsAsync();
}
export function observe(
  tap: (id: string, data: unknown) => void,
  refresh: () => void,
  foreground: (data: unknown) => boolean,
) {
  let alive = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show = alive && foreground(notification.request.content.data);
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  const accept = (response: Notifications.NotificationResponse) => {
    if (alive && response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER)
      tap(response.notification.request.identifier, response.notification.request.content.data);
  };
  const response = Notifications.addNotificationResponseReceivedListener(accept);
  const token = Notifications.addPushTokenListener(() => {
    if (alive) refresh();
  });
  void Notifications.getLastNotificationResponseAsync()
    .then((value) => {
      if (value) accept(value);
    })
    .catch(() => {});
  return () => {
    alive = false;
    response.remove();
    token.remove();
    Notifications.setNotificationHandler(null);
  };
}
