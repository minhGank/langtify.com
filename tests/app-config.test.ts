import type { ConfigContext } from 'expo/config';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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
const originalDisableIosPush = process.env.LANGTIFY_DISABLE_IOS_PUSH;
beforeEach(() => {
  delete process.env.LANGTIFY_DISABLE_IOS_PUSH;
  delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  delete process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
});
afterEach(() => {
  if (originalDisableIosPush === undefined) delete process.env.LANGTIFY_DISABLE_IOS_PUSH;
  else process.env.LANGTIFY_DISABLE_IOS_PUSH = originalDisableIosPush;
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  if (originalProject === undefined) delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  else process.env.EXPO_PUBLIC_EAS_PROJECT_ID = originalProject;
  if (originalGoogleServices === undefined) delete process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
  else process.env.LANGTIFY_GOOGLE_SERVICES_FILE = originalGoogleServices;
});
it('opts into Personal Team configuration without losing Android plugins or EAS metadata', () => {
  process.env.LANGTIFY_DISABLE_IOS_PUSH = '1';
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '10000000-0000-4000-8000-000000000001';
  const config = {
    ...context.config,
    plugins: ['expo-notifications'],
    android: { package: 'com.langtify.app' },
    extra: { existing: 'preserved' },
  };
  const result = configure({ ...context, config });
  expect(result.plugins).toEqual(['./plugins/with-personal-team-ios', 'expo-notifications']);
  expect(result.android).toEqual(config.android);
  expect(result.extra).toEqual({
    existing: 'preserved',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
    langtifyDisableIosPush: true,
  });
});
it.each([undefined, '0', 'true'])('keeps default push configuration for flag %s', (flag) => {
  if (flag !== undefined) process.env.LANGTIFY_DISABLE_IOS_PUSH = flag;
  const config = { ...context.config, plugins: ['expo-notifications'] };
  expect(configure({ ...context, config })).toEqual(config);
});
it('removes only the iOS push entitlement after all real Expo config mods run', () => {
  const inspect = (flag: string) => {
    const result: {
      _internal: {
        modResults: { ios: { entitlements: Record<string, unknown> }; android: unknown };
      };
    } = JSON.parse(
      execFileSync(
        process.execPath,
        [resolve('node_modules/expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
        {
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            EXPO_NO_DOTENV: '1',
            EXPO_NO_TELEMETRY: '1',
            EXPO_PUBLIC_SUPABASE_URL: '',
            EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
            EXPO_PUBLIC_EAS_PROJECT_ID: '',
            LANGTIFY_GOOGLE_SERVICES_FILE: '',
            LANGTIFY_DISABLE_IOS_PUSH: flag,
          },
        },
      ),
    );
    return result._internal.modResults;
  };
  const normal = inspect('0');
  const personal = inspect('1');
  expect(normal.ios.entitlements['aps-environment']).toBe('development');
  expect(personal.ios.entitlements).not.toHaveProperty('aps-environment');
  const remaining = { ...normal.ios.entitlements };
  delete remaining['aps-environment'];
  expect(personal.ios.entitlements).toEqual(remaining);
  expect(personal.android).toEqual(normal.android);
}, 60000);
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
