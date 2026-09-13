import { ProgressPanel } from '@/features/progress/progress-panel';
import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { SignOutButton } from '@/features/auth/sign-out-button';

export function ProfileScreen() {
  const { account, session } = useAuth();
  const learning = account?.learning;
  const target = account?.languages.find(
    (language) => language.id === learning?.target_language_id,
  );
  const reference = account?.languages.find(
    (language) => language.id === learning?.reference_language_id,
  );
  return (
    <Screen hasTabBar>
      <AppText variant="title">Profile</AppText>
      <AppText>{account?.profile?.username}</AppText>
      <AppText>Learning {target?.name ?? 'language unavailable'}</AppText>
      <AppText>Reference language: {reference?.name ?? 'unavailable'}</AppText>
      <AppText>CEFR level: {learning?.cefr_level}</AppText>
      <AppText>Timezone: {learning?.timezone}</AppText>
      {session && (
        <ProgressPanel
          key={`${session.user.id}:${learning?.timezone}`}
          userId={session.user.id}
          accessToken={session.access_token}
          detailed
        />
      )}
      <SignOutButton />
    </Screen>
  );
}
