import { requireSupabase } from '@/lib/supabase';
import { normalizeUsername, type OnboardingInput } from '@/features/onboarding/validation';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type LearningProfile = Database['public']['Tables']['user_language_profiles']['Row'];
export type Language = Database['public']['Tables']['languages']['Row'];
export type Account = {
  profile: Profile | null;
  learning: LearningProfile | null;
  languages: Language[];
};

export async function loadAccount(userId: string): Promise<Account> {
  const client = requireSupabase();
  // Confirm the restored token with Auth before unlocking application routes.
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError) throw identityError;
  if (identity.user?.id !== userId) throw new Error('Session changed.');
  const [profile, learning, languages] = await Promise.all([
    client.from('profiles').select('*').eq('id', userId).maybeSingle(),
    client.from('user_language_profiles').select('*').eq('user_id', userId).maybeSingle(),
    client.from('languages').select('*').order('name'),
  ]);
  if (profile.error) throw profile.error;
  if (learning.error) throw learning.error;
  if (languages.error) throw languages.error;
  return { profile: profile.data, learning: learning.data, languages: languages.data };
}

export async function completeOnboarding(input: OnboardingInput, accessToken: string) {
  // Pin the caller's token: the shared SDK can switch sessions while a request
  // waits for its auth lock. RLS/RPC still derive identity from the verified JWT.
  const { error } = await requireSupabase()
    .rpc('complete_onboarding', {
      p_username: normalizeUsername(input.username),
      p_reference_language_id: input.referenceLanguageId,
      p_target_language_id: input.targetLanguageId,
      p_cefr_level: input.cefrLevel,
      p_timezone: input.timezone.trim(),
    })
    .setHeader('Authorization', `Bearer ${accessToken}`);
  if (error) throw error;
}
