import { permission, pushToken } from '@/features/notifications/device.native';
import { Platform } from 'react-native';
const mockExtra = { langtifyDisableIosPush: false };
jest.mock('expo-constants', () => ({
  get expoConfig() {
    return { extra: mockExtra };
  },
}));
const mockGet = jest.fn(),
  mockRequest = jest.fn(),
  mockPush = jest.fn();
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockGet(),
  requestPermissionsAsync: () => mockRequest(),
  getExpoPushTokenAsync: (arg: unknown) => mockPush(arg),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
const original = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const originalPlatform = Platform.OS;
afterEach(() => {
  mockExtra.langtifyDisableIosPush = false;
  Object.defineProperty(Platform, 'OS', { value: originalPlatform });
  jest.clearAllMocks();
  if (original === undefined) delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  else process.env.EXPO_PUBLIC_EAS_PROJECT_ID = original;
});
it('keeps Personal Team iOS registration unavailable without requesting permission or a token', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
  mockExtra.langtifyDisableIosPush = true;
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '10000000-0000-4000-8000-000000000001';
  expect(await permission(true)).toBe('unavailable');
  expect(await pushToken()).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
it('retains Android registration even when the Personal Team iOS flag is enabled', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android' });
  mockExtra.langtifyDisableIosPush = true;
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '10000000-0000-4000-8000-000000000001';
  mockGet.mockResolvedValue({ status: 'granted' });
  mockPush.mockResolvedValue({ data: 'ExpoPushToken[fixture]' });
  expect(await permission()).toBe('granted');
  expect(await pushToken()).toBe('ExpoPushToken[fixture]');
});
it('never prompts automatically or nags after denial', async () => {
  mockGet.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  expect(await permission()).toBe('undetermined');
  expect(mockRequest).not.toHaveBeenCalled();
  mockRequest.mockResolvedValue({ status: 'denied', canAskAgain: false });
  expect(await permission(true)).toBe('denied');
  mockGet.mockResolvedValue({ status: 'denied', canAskAgain: true });
  await permission(true);
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('uses the configured public EAS project for native token acquisition', async () => {
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '10000000-0000-4000-8000-000000000001';
  mockPush.mockResolvedValue({ data: 'ExpoPushToken[fixture]' });
  expect(await pushToken()).toBe('ExpoPushToken[fixture]');
  expect(mockPush).toHaveBeenCalledWith({ projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID });
});
