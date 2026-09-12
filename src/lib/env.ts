import { validatePublicConfig } from '@/lib/public-config';

export { validatePublicConfig } from '@/lib/public-config';

export const publicConfig = validatePublicConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
