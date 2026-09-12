import type { Session } from '@supabase/supabase-js';

import { isCefrLevel } from '@/features/onboarding/validation';
import type { Account } from '@/services/account';

export type SessionState = {
  status: 'loading' | 'signed-out' | 'onboarding' | 'ready' | 'error' | 'unconfigured';
  session: Session | null;
  account: Account | null;
};

export function hasCompletedOnboarding(account: Account, userId: string) {
  const { profile, learning } = account;
  return Boolean(
    profile?.id === userId &&
    profile.username &&
    profile.onboarding_completed_at &&
    learning?.user_id === userId &&
    learning.reference_language_id !== learning.target_language_id &&
    isCefrLevel(learning.cefr_level) &&
    // PostgreSQL validated this stored timezone; device tzdata may be older.
    learning.timezone.trim().length > 0,
  );
}
