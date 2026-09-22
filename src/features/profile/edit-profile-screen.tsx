import { useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import type { SafetyIdentity } from '@/features/safety/model';
import { normalizeUsername } from '@/features/onboarding/validation';
import { socialGateway } from '@/services/social';
import { socialChanged } from '@/features/social/cache';
import { AvatarEditor } from './avatar-editor';

export function EditProfileScreen() {
  const { status, session, account, refreshAccount } = useAuth();
  const identity = useMemo(
    () => (session ? { userId: session.user.id, token: session.access_token } : null),
    [session],
  );
  if (status !== 'ready' || !identity) return null;
  return (
    <EditProfile
      key={`${identity.userId}:${identity.token}`}
      identity={identity}
      username={account?.profile?.username ?? ''}
      saved={refreshAccount}
    />
  );
}
function EditProfile({
  identity,
  username,
  saved,
}: {
  identity: SafetyIdentity;
  username: string;
  saved: () => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [draft, setDraft] = useState(username);
  const [error, setError] = useState('');
  const [photoNotice, setPhotoNotice] = useState('');
  const usernameChanged = normalizeUsername(draft) !== normalizeUsername(username);
  const closed = useRef(false);
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const task = useSafetyTask(() => {});
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };
  return (
    <Screen>
      <IconButton name="chevron-back" label="Back to Profile" onPress={close} />
      <AppText variant="title">Edit public profile</AppText>
      <AvatarEditor
        identity={identity}
        username={username}
        onChanged={() => setPhotoNotice('Profile photo updated.')}
      />
      {!!photoNotice && (
        <AppText variant="caption" accessibilityLiveRegion="polite">
          {photoNotice}
        </AppText>
      )}
      <FormField
        label="Username"
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setError('');
        }}
        maxLength={30}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!task.busy}
        error={error}
        hint="3–30 letters, numbers or underscores. Visible with your public activity."
      />
      <Button
        label="Save username"
        loading={task.busy}
        disabled={!usernameChanged}
        onPress={() => {
          if (!usernameChanged) return;
          const normalized = normalizeUsername(draft);
          if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(normalized)) {
            setError('Use 3–30 letters, numbers or underscores, starting with a letter or number.');
            return;
          }
          void task.run(
            async (signal) => {
              try {
                await gateway.updateUsername(normalized, signal);
                if (signal.aborted) return null;
                socialChanged('profile');
                // Keep the ready route mounted while refreshing the confirmed
                // account. A full Auth reload removes its pending back action.
                await saved();
                return null;
              } catch (cause) {
                return cause instanceof Error ? cause.message : 'Could not save your username.';
              }
            },
            (message) => {
              if (message) {
                setError(message);
                return;
              }
              close();
            },
          );
        }}
      />
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {task.error}
        </AppText>
      )}
    </Screen>
  );
}
