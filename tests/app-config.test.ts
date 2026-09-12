import type { ConfigContext } from 'expo/config';
import configure from '../app.config';

const context: ConfigContext = {
  config: { name: 'Langtify', slug: 'langtify' },
  projectRoot: process.cwd(),
  staticConfigPath: null,
  packageJsonPath: null,
};
const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const originalKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
});
it('preserves static app configuration when public env is absent', () => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  expect(configure(context)).toEqual(context.config);
});
it.each([
  'sb_secret_fixture',
  `header.${btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '')}.signature`,
])('blocks privileged key configuration before bundling', (key) => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
  expect(() => configure(context)).toThrow('Invalid Supabase public configuration');
  try {
    configure(context);
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).not.toContain(key);
  }
});
it('allows valid public configuration without adding credentials to Expo metadata', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture';
  expect(configure(context)).toEqual(context.config);
});
