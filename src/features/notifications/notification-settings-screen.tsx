import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { notificationGateway } from '@/services/notifications';
import { useAppTheme } from '@/hooks/use-app-theme';
import { timezoneLabel } from '@/features/onboarding/timezones';
import { validTime, type NotificationIdentity, type NotificationPreferences } from './model';
import { useNotifications } from './notification-provider';
import { NotificationTimeField } from './notification-time-field';

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
  const { colors } = useAppTheme();
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
  const permissionCopy = {
    granted: 'Notifications allowed on this device',
    denied: 'Notifications are off on this device',
    undetermined: 'A little reminder to keep learning',
    unavailable: 'Push notifications are unavailable on this device',
  }[native.permission];
  return (
    <Screen>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          label="Back to Profile"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
        />
        <AppText variant="heading" style={styles.heading}>
          Notifications
        </AppText>
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.permission}>
          <View style={[styles.permissionIcon, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons
              name={
                native.permission === 'granted'
                  ? 'notifications-outline'
                  : 'notifications-off-outline'
              }
              size={24}
              color={colors.muted}
            />
          </View>
          <AppText variant="label" style={styles.heading}>
            {permissionCopy}
          </AppText>
        </View>
        {native.permission === 'undetermined' && (
          <Button
            label="Allow notifications"
            loading={native.busy}
            onPress={() => void native.refresh(true)}
          />
        )}
        {native.permission === 'denied' && (
          <Button
            variant="secondary"
            label="Open device Settings"
            onPress={() => {
              setSettingsError(false);
              void Linking.openSettings().catch(() => setSettingsError(true));
            }}
          />
        )}
        {native.permission === 'unavailable' && (
          <AppText variant="caption" style={{ color: colors.muted }}>
            You can still save your reminder preferences below.
          </AppText>
        )}
        {settingsError && (
          <AppText style={{ color: colors.danger }} accessibilityRole="alert">
            Unable to open Settings. Open your device’s Settings app.
          </AppText>
        )}
        {native.error && (
          <>
            <AppText style={{ color: colors.danger }} accessibilityRole="alert">
              {native.error}
            </AppText>
            <Button
              variant="secondary"
              label="Retry device registration"
              loading={native.busy}
              onPress={() => void native.refresh(false, true)}
            />
          </>
        )}
      </View>
      {value ? (
        <>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <PreferenceSwitch
              label="Notifications enabled"
              value={value.enabled}
              disabled={task.busy}
              onChange={(enabled) => {
                setSaved(false);
                setValue({ ...value, enabled });
              }}
            />
          </View>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <PreferenceSwitch
              label="Daily 3 words"
              hint="Your daily challenge, ready to explore."
              value={value.dailyWords}
              disabled={task.busy || !value.enabled}
              onChange={(dailyWords) => {
                setSaved(false);
                setValue({ ...value, dailyWords });
              }}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <NotificationTimeField
              label="Daily time"
              value={value.dailyTime}
              disabled={task.busy || !value.enabled || !value.dailyWords}
              onChange={(dailyTime) => {
                setSaved(false);
                setValue({ ...value, dailyTime });
              }}
            />
          </View>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <PreferenceSwitch
              label="Streak reminder"
              hint="A nudge when your streak needs a word."
              value={value.streakReminder}
              disabled={task.busy || !value.enabled}
              onChange={(streakReminder) => {
                setSaved(false);
                setValue({ ...value, streakReminder });
              }}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <NotificationTimeField
              label="Streak reminder time"
              value={value.streakTime}
              disabled={task.busy || !value.enabled || !value.streakReminder}
              onChange={(streakTime) => {
                setSaved(false);
                setValue({ ...value, streakTime });
              }}
            />
          </View>
          <AppText variant="caption" style={{ color: colors.muted }}>
            Times use your saved timezone: {timezoneLabel(value.timezone)}
          </AppText>
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
          {saved && (
            <AppText style={{ color: colors.success }} accessibilityLiveRegion="polite">
              Notification preferences saved.
            </AppText>
          )}
          <AppText variant="caption" style={{ color: colors.muted }}>
            Reminders depend on device permissions and service availability.
          </AppText>
        </>
      ) : task.busy ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading preferences" />
      ) : null}
      {task.error && (
        <>
          <AppText style={{ color: colors.danger }} accessibilityRole="alert">
            {task.error}
          </AppText>
          <Button
            variant="secondary"
            label="Reload preferences"
            loading={task.busy}
            onPress={() => void task.run(api.load, setValue)}
          />
        </>
      )}
    </Screen>
  );
}
function PreferenceSwitch({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.switchRow, { opacity: disabled ? 0.5 : 1 }]}>
      <View style={styles.switchCopy}>
        <AppText variant="label">{label}</AppText>
        {hint && (
          <AppText variant="caption" style={{ color: colors.muted }}>
            {hint}
          </AppText>
        )}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        value={value}
        disabled={disabled}
        trackColor={{ true: colors.primary }}
        onValueChange={onChange}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flex: 1 },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  permissionIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
  switchCopy: { flex: 1, gap: 4 },
  divider: { height: StyleSheet.hairlineWidth },
});
