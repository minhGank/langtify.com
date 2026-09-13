import { captureWebOAuthReturn } from '@/features/auth/oauth/web-entry.web';
import { listenOAuthReturns } from '@/features/auth/oauth/return-queue';
it('captures the valid return and cleans location before a Router bootstrap can read it', () => {
  let location = new URL('https://langtify.com/auth/callback?code=sensitive-fixture-code');
  const history = {
    state: { retained: true },
    replaceState: jest.fn((_state: unknown, _title: string, path?: string | URL | null) => {
      location = new URL(String(path), location);
    }),
  };
  const liveLocation = {
    get href() {
      return location.href;
    },
    get origin() {
      return location.origin;
    },
  };
  captureWebOAuthReturn(liveLocation, history);
  expect(location.href).toBe('https://langtify.com/auth/callback');
  expect(history.replaceState).toHaveBeenCalledWith({ retained: true }, '', '/auth/callback');
  const receive = jest.fn();
  const stop = listenOAuthReturns(receive);
  expect(receive).toHaveBeenCalledWith(
    'https://langtify.com/auth/callback?code=sensitive-fixture-code',
  );
  stop();
});
it.each([
  'https://langtify.com/auth/callback/?code=sensitive',
  'https://langtify.com/unexpected#access_token=sensitive',
])('redacts malformed callback input without authorizing it: %s', (href) => {
  const history = { state: null, replaceState: jest.fn() };
  captureWebOAuthReturn(new URL(href), history);
  const receive = jest.fn();
  const stop = listenOAuthReturns(receive);
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/auth/callback');
  expect(receive).not.toHaveBeenCalled();
  stop();
});
