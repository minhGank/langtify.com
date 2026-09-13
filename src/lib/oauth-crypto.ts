import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

// auth-js uses WebCrypto for PKCE. Supply only its required native primitives;
// never permit its Math.random/plain-challenge fallback. Web uses browser crypto.
export function ensureOAuthCrypto() {
  if (Platform.OS !== 'web') {
    if (!globalThis.crypto)
      Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    if (!globalThis.crypto.getRandomValues)
      Object.defineProperty(globalThis.crypto, 'getRandomValues', {
        value: Crypto.getRandomValues,
        configurable: true,
      });
    if (!globalThis.crypto.subtle)
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: {
          digest: (algorithm: string, data: BufferSource) => {
            if (algorithm !== 'SHA-256') throw new Error('Unsupported OAuth digest.');
            return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
          },
        },
        configurable: true,
      });
  }
  if (
    !globalThis.crypto?.getRandomValues ||
    !globalThis.crypto.subtle?.digest ||
    typeof TextEncoder === 'undefined'
  )
    throw new Error('Secure OAuth is unavailable.');
}
