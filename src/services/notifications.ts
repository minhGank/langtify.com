import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/env';
import type { Database } from '@/types/database';
import { record, text, flag, SafetyUnavailable } from '@/features/safety/model';
import {
  validTime,
  type Installation,
  type NotificationIdentity,
  type NotificationPreferences,
} from '@/features/notifications/model';

function client(identity: NotificationIdentity | null) {
  const config = publicConfig.config;
  if (!config) throw new Error('Notification configuration is unavailable.');
  return createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity?.token ?? null,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export function notificationGateway(identity: NotificationIdentity) {
  const api = client(identity);
  async function receive(request: PromiseLike<{ data: unknown; error: unknown }>) {
    const result = await request;
    if (result.error) {
      if (record(result.error).code === '42501')
        throw new SafetyUnavailable('Notification settings are unavailable for this session.');
      throw new Error('Unable to confirm notification settings. Try again.');
    }
    const row = record(result.data);
    if (row.user_id !== identity.userId || row.delivery_contract !== 'at_most_one_attempt')
      throw new Error('Notification settings changed.');
    const dailyTime = text(row.daily_time).slice(0, 5),
      streakTime = text(row.streak_time).slice(0, 5);
    if (!validTime(dailyTime) || !validTime(streakTime))
      throw new Error('Invalid notification times.');
    return {
      enabled: flag(row.enabled),
      dailyWords: flag(row.daily_words),
      streakReminder: flag(row.streak_reminder),
      dailyTime,
      streakTime,
      timezone: text(row.timezone),
    };
  }
  return {
    load(signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(new Error('Cancelled.'));
      return receive(api.rpc('get_notification_preferences').abortSignal(signal));
    },
    save(value: NotificationPreferences, signal: AbortSignal) {
      if (signal.aborted || !validTime(value.dailyTime) || !validTime(value.streakTime))
        return Promise.reject(new Error('Enter times as HH:MM.'));
      return receive(
        api
          .rpc('save_notification_preferences', {
            notifications_enabled: value.enabled,
            daily_enabled: value.dailyWords,
            streak_enabled: value.streakReminder,
            daily_at: value.dailyTime,
            streak_at: value.streakTime,
          })
          .abortSignal(signal),
      );
    },
  };
}
export async function syncInstallation(
  value: Installation,
  identity: NotificationIdentity | null,
  token: string | null,
  platform: 'ios' | 'android',
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const result = await client(identity)
    .rpc('sync_push_installation', {
      installation_id: value.id,
      installation_secret: value.secret,
      installation_revision: value.revision,
      push_token: token ?? undefined,
      device_platform: token ? platform : undefined,
    })
    .abortSignal(signal);
  if (result.error) throw new Error('Device notification registration could not be confirmed.');
}
