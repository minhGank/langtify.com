import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { coordinator, oauthRedirect } from './runtime';
import { isCallbackUrl } from './callback';
import { listenOAuthReturns } from './return-queue';

let mountedBridges = 0;
export function OAuthBridge() {
  useEffect(() => {
    ++mountedBridges;
    let alive = true;
    const accept = (url: string) => {
      if (!alive || !isCallbackUrl(url, oauthRedirect())) return;
      void coordinator.receive(url);
    };
    const stop = listenOAuthReturns(accept);
    const subscription = Linking.addEventListener('url', (event) => accept(event.url));
    if (Platform.OS !== 'web')
      void Linking.getInitialURL()
        .then((url) => {
          if (url) accept(url);
        })
        .catch(() => {});
    return () => {
      alive = false;
      stop();
      subscription.remove();
      --mountedBridges;
      // Allow React Strict Mode's immediate effect remount, but invalidate work
      // when the owning auth provider has actually left the tree.
      queueMicrotask(() => {
        if (mountedBridges === 0) coordinator.accountChanged();
      });
    };
  }, []);
  return null;
}
