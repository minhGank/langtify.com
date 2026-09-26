import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { FormField } from '@/components/ui/form-field';
import { safetyGateway } from '@/services/safety';
import type { FeedItem } from '@/services/discover';
import { isReportReason, reportReasons, type ReportReason, type SafetyIdentity } from './model';
import { useSafetyTask } from './use-safety-task';
import { socialChanged } from '@/features/social/cache';

export function CardActions({
  identity,
  item,
  close,
  blocked,
}: {
  identity: SafetyIdentity;
  item: FeedItem;
  close: () => void;
  blocked: () => void;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => safetyGateway(identity), [identity]);
  const [mode, setMode] = useState<'menu' | 'submission' | 'user' | 'block' | 'done'>('menu');
  const [reason, setReason] = useState<ReportReason>('inappropriate'),
    [details, setDetails] = useState('');
  const [confirm, setConfirm] = useState(false);
  const task = useSafetyTask(close);
  return (
    <Sheet
      visible
      title={
        mode === 'menu'
          ? 'Photo options'
          : mode === 'block'
            ? 'Block account'
            : mode === 'done'
              ? 'Report received'
              : 'Report'
      }
      onClose={close}
    >
      <AppText variant="caption">
        {item.targetTerm} · @{item.username}
      </AppText>
      {mode === 'menu' && (
        <>
          {(
            [
              { label: 'Report photo', mode: 'submission', icon: 'flag-outline' },
              { label: 'Report user', mode: 'user', icon: 'person-outline' },
              { label: 'Block user', mode: 'block', icon: 'ban-outline' },
            ] as const
          ).map((entry) => (
            <Pressable
              key={entry.mode}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              onPress={() => setMode(entry.mode)}
              style={[styles.menuRow, { borderBottomColor: colors.border }]}
            >
              <Ionicons
                name={entry.icon}
                size={22}
                color={entry.mode === 'block' ? colors.error : colors.textPrimary}
              />
              <AppText
                style={{
                  flex: 1,
                  color: entry.mode === 'block' ? colors.error : colors.textPrimary,
                }}
              >
                {entry.label}
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </>
      )}
      {(mode === 'submission' || mode === 'user') && (
        <>
          <AppText>{mode === 'submission' ? 'Report this photo' : 'Report this account'}</AppText>
          {!confirm ? (
            <>
              <ChoiceField
                label="Report reason"
                value={reason}
                options={reportReasons}
                disabled={task.busy}
                onChange={(value) => {
                  if (isReportReason(value)) setReason(value);
                }}
              />
              <FormField
                label="Additional details (optional)"
                value={details}
                onChangeText={setDetails}
                maxLength={500}
                multiline
                editable={!task.busy}
                hint="Up to 500 characters. Leave out personal details."
              />
              <Button label="Review report" onPress={() => setConfirm(true)} />
            </>
          ) : (
            <>
              <AppText>{reportReasons.find((r) => r.value === reason)?.label}</AppText>
              {details.length > 0 && <AppText>{details}</AppText>}
              <AppText>
                Only moderators can see your report. Your name won’t be shared with this person.
              </AppText>
              <Button
                label="Confirm report"
                loading={task.busy}
                onPress={() =>
                  void task.run(
                    (signal) => gateway.report(item.id, mode, reason, details, signal),
                    () => setMode('done'),
                  )
                }
              />
              <Button
                variant="ghost"
                label="Edit report"
                disabled={task.busy}
                onPress={() => setConfirm(false)}
              />
            </>
          )}
        </>
      )}
      {mode === 'block' && (
        <>
          <AppText>Block @{item.username}?</AppText>
          <AppText>
            You won’t see each other’s public activity or be able to interact. You can unblock them
            in Profile.
          </AppText>
          <Button
            variant="danger"
            label="Confirm block"
            loading={task.busy}
            onPress={() =>
              void task.run(
                (signal) => gateway.block(item.id, signal),
                () => {
                  socialChanged('block');
                  blocked();
                },
              )
            }
          />
        </>
      )}
      {mode === 'done' && (
        <View style={styles.received}>
          <Ionicons name="checkmark-circle-outline" size={42} color={colors.success} />
          <AppText>Thanks for letting us know. A moderator can review your report.</AppText>
        </View>
      )}
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.error }}>
          {task.error}
        </AppText>
      )}
      <Button variant="ghost" label={mode === 'done' ? 'Done' : 'Cancel'} onPress={close} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  menuRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  received: { alignItems: 'center', gap: 16, paddingVertical: 24 },
});
