import type { Session } from '@supabase/supabase-js';
import type { Account } from '@/services/account';

export function makeSession(id = '10000000-0000-4000-8000-000000000001'): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-09-12T00:00:00Z',
    },
  };
}
export function makeAccount(id = makeSession().user.id): Account {
  return {
    profile: {
      id,
      username: 'learner',
      created_at: '2026-09-12T00:00:00Z',
      updated_at: '2026-09-12T00:00:00Z',
      onboarding_completed_at: '2026-09-12T00:00:00Z',
    },
    learning: {
      id: 'learning-id',
      user_id: id,
      reference_language_id: 'en',
      target_language_id: 'fr',
      cefr_level: 'B1',
      timezone: 'America/Toronto',
      created_at: '2026-09-12T00:00:00Z',
      updated_at: '2026-09-12T00:00:00Z',
    },
    languages: [
      {
        id: 'en',
        code: 'en',
        name: 'English',
        native_name: 'English',
        is_active: true,
        created_at: '2026-09-12T00:00:00Z',
      },
      {
        id: 'fr',
        code: 'fr',
        name: 'French',
        native_name: 'Français',
        is_active: true,
        created_at: '2026-09-12T00:00:00Z',
      },
    ],
  };
}

export function makeOAuthSession(id?: string, sessionId = 'test-oauth-session'): Session {
  return {
    ...makeSession(id),
    access_token: `fixture.${btoa(JSON.stringify({ session_id: sessionId }))}.signature`,
  };
}
