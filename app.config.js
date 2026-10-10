const { backendConfiguration } = require('./src/lib/backend-environment');

/** @param {import('expo/config').ConfigContext} context */
module.exports = ({ config }) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const googleServicesFile = process.env.LANGTIFY_GOOGLE_SERVICES_FILE;
  const disableIosPush = process.env.LANGTIFY_DISABLE_IOS_PUSH === '1';
  const profile = process.env.EAS_BUILD_PROFILE;
  const nativeRelease =
    (profile !== undefined && profile !== 'development') ||
    (process.env.CONFIGURATION !== undefined && process.env.CONFIGURATION !== 'Debug');
  const backend = backendConfiguration(
    process.env.EXPO_PUBLIC_BACKEND_ENV,
    url,
    key,
    nativeRelease,
  );
  if (
    (nativeRelease || process.env.EXPO_PUBLIC_BACKEND_ENV === 'production') &&
    process.env.EXPO_NO_DOTENV !== '1'
  ) {
    throw new Error('Release requires EXPO_NO_DOTENV=1 and explicit public build configuration.');
  }
  if ((nativeRelease || process.env.EXPO_PUBLIC_BACKEND_ENV === 'production') && disableIosPush) {
    throw new Error('Production cannot use Personal Team push removal.');
  }
  if (projectId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error('Invalid public EAS project ID. Use the project UUID, never a credential.');
  }
  // Missing configuration retains the explicit setup screen. Supplied but unsafe
  // values must stop Metro/export BEFORE Expo embeds public env in the JS bundle.
  if ((url || key) && !backend.config) {
    throw new Error(
      'Invalid Supabase public configuration. Use an HTTPS API URL (HTTP only for local development) and a public publishable/anon key. Never use service-role or secret keys.',
    );
  }
  const result = {
    ...config,
    ...(projectId ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } } : {}),
    ...(googleServicesFile ? { android: { ...config.android, googleServicesFile } } : {}),
  };
  if (disableIosPush) {
    // Entitlement mods execute in reverse registration order. Register first so
    // removal runs after expo-notifications, preserving its Android setup.
    result.plugins = ['./plugins/with-personal-team-ios', ...(config.plugins ?? [])];
    result.extra = { ...result.extra, langtifyDisableIosPush: true };
  }
  return result;
};
