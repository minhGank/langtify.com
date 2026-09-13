import { callbackPath, hasOAuthParameters, isCallbackUrl } from './callback';
import { queueOAuthReturn } from './return-queue';

// Imported BEFORE expo-router/entry: ExpoRoot captures location at module load,
// so a React effect is too late to keep codes out of initial navigation state.
export function captureWebOAuthReturn(
  location: { href: string; origin: string },
  history: Pick<History, 'replaceState' | 'state'>,
) {
  const raw = location.href;
  const redirect = new URL(`/${callbackPath}`, location.origin).href;
  if (!hasOAuthParameters(raw)) return;
  const valid = isCallbackUrl(raw, redirect);
  history.replaceState(history.state, '', `/${callbackPath}`);
  if (valid) queueOAuthReturn(raw);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  captureWebOAuthReturn(window.location, window.history);
}
