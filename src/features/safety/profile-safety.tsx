import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { safetyGateway } from '@/services/safety';
import type { SafetyAccess, SafetyIdentity } from './model';
import { useSafetyTask } from './use-safety-task';
export function ProfileSafety({ userId, token }: SafetyIdentity) {
  const gateway = useMemo(() => safetyGateway({ userId, token }), [userId, token]);
  const [access, setAccess] = useState<SafetyAccess | null>(null);
  const task = useSafetyTask(
    () => setAccess(null),
    (run) => {
      void run(gateway.access, setAccess);
    },
  );
  return (
    <>
      <Button label="Blocked users" onPress={() => router.push('/blocked-users')} />
      {access?.restricted && (
        <AppText>
          Your account’s public access is restricted. Your private learning data remains available.
        </AppText>
      )}
      {access?.moderator && (
        <Button label="Moderation" onPress={() => router.push('/moderation')} />
      )}
      {task.error && (
        <Button
          label="Refresh account safety status"
          onPress={() => void task.run(gateway.access, setAccess)}
        />
      )}
    </>
  );
}
