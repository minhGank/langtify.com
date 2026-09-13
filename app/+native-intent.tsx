import {
  appScheme,
  callbackPath,
  hasOAuthParameters,
  isCallbackUrl,
} from '@/features/auth/oauth/callback';
import { queueOAuthReturn } from '@/features/auth/oauth/return-queue';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (isCallbackUrl(path, `${appScheme}://${callbackPath}`)) {
    queueOAuthReturn(path);
    return `/${callbackPath}`; // OAuth codes never become Router search params/history.
  }
  if (hasOAuthParameters(path)) return `/${callbackPath}`;
  return path;
}
