const { validatePublicConfig } = require('./src/lib/public-config');

/** @param {import('expo/config').ConfigContext} context */
module.exports = ({ config }) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  // Missing configuration retains the explicit setup screen. Supplied but unsafe
  // values must stop Metro/export BEFORE Expo embeds public env in the JS bundle.
  if ((url || key) && !validatePublicConfig(url, key).config) {
    throw new Error(
      'Invalid Supabase public configuration. Use an HTTPS API URL (HTTP only for local development) and a public publishable/anon key. Never use service-role or secret keys.',
    );
  }
  return config;
};
