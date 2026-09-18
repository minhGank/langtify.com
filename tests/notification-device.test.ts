import { permission, pushToken } from '@/features/notifications/device.native';
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
afterEach(() => {
  jest.clearAllMocks();
  if (original === undefined) delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  else process.env.EXPO_PUBLIC_EAS_PROJECT_ID = original;
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
