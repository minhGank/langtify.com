import { useMemo, useState } from 'react';
import { Modal } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { safetyGateway } from '@/services/safety';
import type { FeedItem } from '@/services/discover';
import { isReportReason, reportReasons, type ReportReason, type SafetyIdentity } from './model';
import { useSafetyTask } from './use-safety-task';

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
  const gateway = useMemo(() => safetyGateway(identity), [identity]);
  const [mode, setMode] = useState<'menu' | 'submission' | 'user' | 'block' | 'done'>('menu');
  const [reason, setReason] = useState<ReportReason>('inappropriate'),
    [details, setDetails] = useState('');
  const [confirm, setConfirm] = useState(false);
  const task = useSafetyTask(close);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <Screen>
        <AppText variant="title">Safety · @{item.username}</AppText>
        <AppText>{item.targetTerm}</AppText>
        {mode === 'menu' && (
          <>
            <Button label="Report photo" onPress={() => setMode('submission')} />
            <Button label="Report user" onPress={() => setMode('user')} />
            <Button label="Block user" onPress={() => setMode('block')} />
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
                  hint="Up to 500 characters. Do not include unnecessary personal information."
                />
                <Button label="Review report" onPress={() => setConfirm(true)} />
              </>
            ) : (
              <>
                <AppText>{reportReasons.find((r) => r.value === reason)?.label}</AppText>
                {details.length > 0 && <AppText>{details}</AppText>}
                <AppText>
                  Your report is private. The reported user will not see who submitted it.
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
              You will stop seeing each other’s public content and cannot rate each other’s photos.
              You can unblock them in Profile.
            </AppText>
            <Button
              label="Confirm block"
              loading={task.busy}
              onPress={() => void task.run((signal) => gateway.block(item.id, signal), blocked)}
            />
          </>
        )}
        {mode === 'done' && <AppText>Thank you. Your report has been received.</AppText>}
        {task.error && <AppText accessibilityRole="alert">{task.error}</AppText>}
        <Button label={mode === 'done' ? 'Done' : 'Cancel'} onPress={close} />
      </Screen>
    </Modal>
  );
}
