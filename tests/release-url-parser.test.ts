import { getStateFromPath as routerStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getStateFromPath as fallbackStateFromPath } from 'expo-router/build/react-navigation/core/getStateFromPath';

// Fail if either parser invokes the vulnerable fallback decoder. This is a call-path
// check, not a timing benchmark or a claim that the package has been patched.
jest.mock('decode-uri-component', () => () => {
  throw new Error('Legacy URL decoder invoked');
});

const options = { screens: { photo: 'photo/:id' } };

describe('SDK 57 release URL parsing', () => {
  it.each(['hello%20world', '%FF'.repeat(64), '%E0%A4%A', '%GG'])(
    'uses the Router URL parser for query input %s',
    (input) => {
      const state = routerStateFromPath(`/photo/123?q=${input}`, options);
      expect(state?.routes[0]).toMatchObject({
        name: 'photo',
        params: { id: '123', q: new URLSearchParams(`q=${input}`).get('q') },
      });
    },
  );

  it('keeps the bundled React Navigation fallback classified as vulnerable', () => {
    expect(() => fallbackStateFromPath('/photo/123?q=%FF', options)).toThrow(
      'Legacy URL decoder invoked',
    );
  });
});
