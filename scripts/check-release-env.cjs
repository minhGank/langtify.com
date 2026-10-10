// Used from native build phases, not just from an optional npm wrapper.
const { backendConfiguration } = require('../src/lib/backend-environment');
try {
  if (process.env.EXPO_NO_DOTENV !== '1') {
    throw new Error('Release requires EXPO_NO_DOTENV=1 and explicit public build configuration.');
  }
  backendConfiguration(
    process.env.EXPO_PUBLIC_BACKEND_ENV,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    true,
  );
  if (process.env.SKIP_BUNDLING || process.env.LANGTIFY_DISABLE_IOS_PUSH === '1') {
    throw new Error('Release cannot skip bundling or use Personal Team push removal.');
  }
  console.log('Langtify release backend verified: Production (public configuration only).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
