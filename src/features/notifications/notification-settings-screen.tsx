import { useMemo, useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { FormField } from '@/components/ui/form-field';
import { Button } from '@/components/ui/button';
import { notificationGateway } from '@/services/notifications';
import { validTime, type NotificationIdentity, type NotificationPreferences } from './model';
import { useNotifications } from './notification-provider';
export function NotificationSettingsScreen() {
  const { status, session } = useAuth();
  return status === 'ready' && session ? (
    <Settings
      key={`${session.user.id}:${session.access_token}`}
      userId={session.user.id}
      token={session.access_token}
    />
  ) : null;
}
function Settings({ userId, token }: NotificationIdentity) {
  const api = useMemo(() => notificationGateway({ userId, token }), [userId, token]);
  const native = useNotifications();
  const [value, setValue] = useState<NotificationPreferences | null>(null),
    [saved, setSaved] = useState(false),
    [settingsError, setSettingsError] = useState(false);
  const task = useSafetyTask(
    () => {
      setValue(null);
      setSaved(false);
    },
    (run) => {
      void run(api.load, setValue);
    },
  );
  return (
    <Screen>
      <AppText variant="title">Notifications</AppText>
      <AppText>
        Daily words and streak reminders use your saved timezone. Each reminder is attempted once;
        delivery depends on your device permissions and service availability.
      </AppText>
      <AppText>Device permission: {native.permission}</AppText>
      {native.permission === 'undetermined' && (
        <Button
          label="Allow notifications"
          loading={native.busy}
          onPress={() => void native.refresh(true)}
        />
      )}
      {native.permission === 'denied' && (
        <Button
          label="Open device Settings"
          onPress={() => {
            void Linking.openSettings().catch(() => setSettingsError(true));
          }}
        />
      )}
      {settingsError && (
        <AppText>Unable to open Settings. Open your device’s Settings app.</AppText>
      )}
      {native.error && <AppText accessibilityRole="alert">{native.error}</AppText>}
      <Button
        label="Refresh device registration"
        loading={native.busy}
        onPress={() => void native.refresh(false, true)}
      />
      {value ? (
        <>
          <AppText>Times use your saved timezone: {value.timezone}</AppText>
          {(
            [
              ['enabled', 'Notifications enabled'],
              ['dailyWords', 'Daily 3 words'],
              ['streakReminder', 'Streak reminder'],
            ] as const
          ).map(([key, label]) => (
            <View key={key}>
              <AppText>{label}</AppText>
              <Switch
                accessibilityLabel={label}
                value={value[key]}
                disabled={task.busy}
                onValueChange={(next) => {
                  setSaved(false);
                  setValue({ ...value, [key]: next });
                }}
              />
            </View>
          ))}
          <FormField
            label="Daily time (HH:MM)"
            value={value.dailyTime}
            maxLength={5}
            editable={!task.busy}
            onChangeText={(dailyTime) => {
              setSaved(false);
              setValue({ ...value, dailyTime });
            }}
          />
          <FormField
            label="Streak reminder time (HH:MM)"
            value={value.streakTime}
            maxLength={5}
            editable={!task.busy}
            onChangeText={(streakTime) => {
              setSaved(false);
              setValue({ ...value, streakTime });
            }}
          />
          {(!validTime(value.dailyTime) || !validTime(value.streakTime)) && (
            <AppText>Enter a 24-hour time, such as 08:00 or 19:00.</AppText>
          )}
          <Button
            label="Save preferences"
            loading={task.busy}
            disabled={!validTime(value.dailyTime) || !validTime(value.streakTime)}
            onPress={() => {
              setSaved(false);
              void task.run(
                (signal) => api.save(value, signal),
                (result) => {
                  setValue(result);
                  setSaved(true);
                },
              );
            }}
          />
          {saved && <AppText>Notification preferences saved.</AppText>}
        </>
      ) : task.busy ? (
        <AppText>Loading preferences…</AppText>
      ) : null}
      {task.error && <AppText accessibilityRole="alert">{task.error}</AppText>}
      <Button
        label="Reload preferences"
        loading={task.busy}
        onPress={() => void task.run(api.load, setValue)}
      />
      <Button label="Back to Profile" onPress={() => router.replace('/(tabs)/profile')} />
    </Screen>
  );
}
