import { useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { friendlyError } from '@/features/auth/errors';
import { requireSupabase } from '@/lib/supabase';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      const result = await requireSupabase().auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
    } catch (cause) {
      setError(friendlyError(cause, 'Unable to sign out. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <AppText accessibilityRole="alert">{error}</AppText>}
      <Button label="Sign out" loading={busy} onPress={() => void signOut()} />
    </>
  );
}
