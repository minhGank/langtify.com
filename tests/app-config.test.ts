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
const originalProject = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const originalGoogleServices = process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
beforeEach(() => {
  delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  delete process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
});
afterEach(() => {
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  if (originalProject === undefined) delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  else process.env.EXPO_PUBLIC_EAS_PROJECT_ID = originalProject;
  if (originalGoogleServices === undefined) delete process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
  else process.env.LANGTIFY_GOOGLE_SERVICES_FILE = originalGoogleServices;
});
it('accepts the optional native Firebase client file without changing the app identity', () => {
  process.env.LANGTIFY_GOOGLE_SERVICES_FILE = '/operator/google-services.json';
  expect(
    configure({
      ...context,
      config: { ...context.config, android: { package: 'com.langtify.app' } },
    }).android,
  ).toEqual({
    package: 'com.langtify.app',
    googleServicesFile: '/operator/google-services.json',
  });
});
it('validates the public EAS UUID before adding project metadata', () => {
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = 'not-a-project';
  expect(() => configure(context)).toThrow('Invalid public EAS project ID');
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '10000000-0000-4000-8000-000000000001';
  expect(configure(context).extra?.eas.projectId).toBe(process.env.EXPO_PUBLIC_EAS_PROJECT_ID);
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
