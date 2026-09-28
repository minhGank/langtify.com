import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from '@/lib/http';

// Explicit rollout contract: leave unset until Confirm signup emails contain
// {{ .Token }}. Match the project's actual 6–10 digit Mailer OTP length.
export function signupCodeLength(value: string | undefined): number | null {
  return value && /^(6|7|8|9|10)$/.test(value) ? Number(value) : null;
}
export const emailCodeLength = signupCodeLength(process.env.EXPO_PUBLIC_SIGNUP_CODE_LENGTH);

export async function exchangeSignupCode(
  config: { url: string; key: string },
  email: string,
  token: string,
) {
  // A candidate never touches the persisted app client or its Auth event stream.
  const client = createClient(config.url, config.key, {
    global: { fetch: boundedFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'langtify-signup-verification',
    },
  });
  try {
    // Narrow to confirmation tokens; do not accept recovery/magic-link codes.
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'signup' });
    if (error) throw error;
    if (!data.session || !data.user?.email_confirmed_at) throw new Error('Verification failed.');
    return data.session;
  } finally {
    await client.auth.dispose();
  }
}
