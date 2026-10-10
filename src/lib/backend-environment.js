// @ts-check
const { validatePublicConfig } = require('./public-config');
const DEV_URL = 'https://ssuyyrfncvyqsgkirvpq.supabase.co';
const PRODUCTION_URL = 'https://lfdgjewypbhukjrtwsef.supabase.co';

/**
 * Development defaults to Dev. An explicitly supplied URL is a development
 * override (including local integration/CI fixtures); production has no fallback.
 * @param {string | undefined} environment
 * @param {string | undefined} url
 * @param {string | undefined} key
 * @param {boolean} [nativeRelease]
 */
function backendConfiguration(environment, url, key, nativeRelease = false) {
  const mode = environment || 'development';
  if (!['development', 'production'].includes(mode)) {
    throw new Error('Invalid backend environment. Select development or production.');
  }
  if (nativeRelease && mode !== 'production') {
    throw new Error('Release requires EXPO_PUBLIC_BACKEND_ENV=production. Dev is forbidden.');
  }
  if (mode === 'production') {
    if (url !== PRODUCTION_URL || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(
        'Production requires the exact Production Supabase URL and a public publishable key. No Dev/local/missing configuration is allowed.',
      );
    }
  }
  return validatePublicConfig(mode === 'production' ? url : url || DEV_URL, key);
}
module.exports = { backendConfiguration, DEV_URL, PRODUCTION_URL };
