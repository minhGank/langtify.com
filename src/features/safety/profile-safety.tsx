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
      <Button
        variant="secondary"
        label="Blocked users"
        onPress={() => router.push('/blocked-users')}
      />
      {access?.restricted && (
        <AppText>
          Your public activity is restricted. You can still use your private photos and learning
          tools.
        </AppText>
      )}
      {access?.moderator && (
        <Button variant="secondary" label="Moderation" onPress={() => router.push('/moderation')} />
      )}
      {task.error && (
        <Button
          variant="ghost"
          label="Check account access"
          onPress={() => void task.run(gateway.access, setAccess)}
        />
      )}
    </>
  );
}
