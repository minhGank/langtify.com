import { act, render } from '@testing-library/react-native';
import { OAuthBridge } from '@/features/auth/oauth/oauth-bridge';
import { redirectSystemPath } from '../app/+native-intent';
import { listenOAuthReturns } from '@/features/auth/oauth/return-queue';
const mockAccountChanged = jest.fn();
const mockReceive = jest.fn().mockResolvedValue(undefined);
const mockInitial = jest.fn();
const mockRemove = jest.fn();
let mockLink: (event: { url: string }) => void = () => {};
jest.mock('@/features/auth/oauth/runtime', () => ({
  coordinator: {
    receive: (...args: unknown[]) => mockReceive(...args),
    accountChanged: () => mockAccountChanged(),
  },
  oauthRedirect: () => 'langtify://auth/callback',
}));
jest.mock('expo-linking', () => ({
  getInitialURL: () => mockInitial(),
  addEventListener: (_type: string, listener: typeof mockLink) => {
    mockLink = listener;
    return { remove: mockRemove };
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockInitial.mockResolvedValue(null);
});
it('strips callback codes from native Router paths and delivers a queued cold return', () => {
  const raw = 'langtify://auth/callback?code=sensitive-test-code';
  expect(redirectSystemPath({ path: raw, initial: true })).toBe('/auth/callback');
  const receiver = jest.fn();
  const stop = listenOAuthReturns(receiver);
  expect(receiver).toHaveBeenCalledWith(raw);
  stop();
  expect(redirectSystemPath({ path: 'langtify://profile', initial: false })).toBe(
    'langtify://profile',
  );
});
it('receives warm and cold exact links without consuming unrelated links', async () => {
  const raw = 'langtify://auth/callback?code=sensitive-test-code';
  mockInitial.mockResolvedValue(raw);
  const app = render(<OAuthBridge />);
  await act(async () => {});
  expect(mockReceive).toHaveBeenCalledWith(raw);
  act(() => mockLink({ url: 'https://evil.test/auth/callback?code=bad-code' }));
  expect(mockReceive).toHaveBeenCalledTimes(1);
  act(() => mockLink({ url: raw }));
  expect(mockReceive).toHaveBeenCalledTimes(2);
  app.unmount();
  expect(mockRemove).toHaveBeenCalled();
});
it('ignores late initial URL lookup after bridge unmount', async () => {
  let resolve!: (url: string) => void;
  mockInitial.mockReturnValue(
    new Promise<string>((yes) => {
      resolve = yes;
    }),
  );
  const app = render(<OAuthBridge />);
  app.unmount();
  await act(async () => resolve('langtify://auth/callback?code=sensitive-test-code'));
  expect(mockReceive).not.toHaveBeenCalled();
  expect(mockAccountChanged).toHaveBeenCalled();
});
it.each([
  'langtify://auth/callback/?code=sensitive-test-code',
  'langtify://auth/callback#access_token=sensitive-test-token',
  'langtify://unexpected?refresh_token=sensitive-test-token',
])('does not pass sensitive malformed callback content into Router: %s', (raw) => {
  expect(redirectSystemPath({ path: raw, initial: true })).not.toContain('sensitive-test');
});
