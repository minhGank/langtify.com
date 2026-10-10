import { backendConfiguration } from '@/lib/backend-environment';

export { validatePublicConfig } from '@/lib/public-config';

export const publicConfig = backendConfiguration(
  process.env.EXPO_PUBLIC_BACKEND_ENV,
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
