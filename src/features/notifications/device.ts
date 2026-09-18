// Web has preferences and safe navigation, but no mobile push capability.
import type { Installation, PushPermission } from './model';
export const devicePlatform: 'ios' | 'android' = 'ios';
export async function permission(_request = false): Promise<PushPermission> {
  return 'unavailable';
}
export async function pushToken(): Promise<string | null> {
  return null;
}
export async function loadInstallation(): Promise<Installation> {
  throw new Error('Mobile push is unavailable.');
}
export async function saveInstallation(_value: Installation): Promise<void> {}
export function observe(
  _tap: (id: string, data: unknown) => void,
  _refresh: () => void,
  _foreground: (data: unknown) => boolean,
) {
  return () => {};
}
export async function clearResponses(): Promise<void> {}
