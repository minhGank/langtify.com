import { useEffect, useMemo, useState } from 'react';
import { Image } from 'react-native';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { FormField } from '@/components/ui/form-field';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { safetyGateway, type SafetyGateway } from '@/services/safety';
import {
  isReportStatus,
  moderationActions,
  type AuditEvent,
  type ModerationAction,
  type ModerationCase,
  type Report,
  type ReportCursor,
  type ReportStatus,
  type SafetyIdentity,
  type SafetyPage,
} from './model';
import { useSafetyTask } from './use-safety-task';
async function caseData(gateway: SafetyGateway, id: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Request cancelled.');
  const nextDetail = await gateway.detail(id, signal);
  if (signal.aborted) throw new Error('Request cancelled.');
  const started = performance.now();
  const [nextHistory, uri] = await Promise.all([
    gateway.history(id, null, signal),
    gateway.photo(id, signal),
  ]);
  return {
    detail: nextDetail,
    history: nextHistory,
    photo: uri ? { uri, expiresAt: started + 55000 } : null,
  };
}

export function ModerationScreen() {
  const { status, session } = useAuth();
  return status === 'ready' && session ? (
    <Moderation
      key={`${session.user.id}:${session.access_token}`}
      userId={session.user.id}
      token={session.access_token}
    />
  ) : null;
}
function Moderation({ userId, token }: SafetyIdentity) {
  const gateway = useMemo(() => safetyGateway({ userId, token }), [userId, token]);
  const [allowed, setAllowed] = useState(false),
    [status, setStatus] = useState<ReportStatus>('open');
  const [queue, setQueue] = useState<SafetyPage<Report> | null>(null),
    [detail, setDetail] = useState<ModerationCase | null>(null);
  const [history, setHistory] = useState<SafetyPage<AuditEvent> | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; expiresAt: number } | null>(null);
  const [reason, setReason] = useState(''),
    [intent, setIntent] = useState<{
      action: ModerationAction;
      requestId: string;
      reason: string;
    } | null>(null);
  function reset() {
    setAllowed(false);
    setQueue(null);
    setDetail(null);
    setHistory(null);
    setPhoto(null);
    setIntent(null);
    setReason('');
  }
  const task = useSafetyTask(reset, (run) => {
    void run(
      async (signal) => {
        const access = await gateway.access(signal);
        return {
          allowed: access.moderator,
          queue: access.moderator ? await gateway.queue(status, null, signal) : null,
        };
      },
      (value) => {
        setAllowed(value.allowed);
        setQueue(value.queue);
      },
    );
  });
  const { run } = task;
  function refresh() {
    if (task.busy) return;
    setQueue(null);
    setDetail(null);
    setHistory(null);
    setPhoto(null);
    setIntent(null);
    void task.run(
      async (signal) => {
        const access = await gateway.access(signal);
        return {
          allowed: access.moderator,
          queue: access.moderator ? await gateway.queue(status, null, signal) : null,
        };
      },
      (value) => {
        setAllowed(value.allowed);
        setQueue(value.queue);
      },
    );
  }
  function loadQueue(nextStatus: ReportStatus, cursor: ReportCursor | null) {
    if (task.busy) return;
    // Rows and their cursor belong to the requested status/page. An uncertain
    // response must not leave the previous filter's pagination controls active.
    setQueue(null);
    setDetail(null);
    setPhoto(null);
    setHistory(null);
    setIntent(null);
    setStatus(nextStatus);
    void task.run((signal) => gateway.queue(nextStatus, cursor, signal), setQueue);
  }
  function acceptCase(value: Awaited<ReturnType<typeof caseData>>) {
    setDetail(value.detail);
    setHistory(value.history);
    setPhoto(value.photo);
  }
  function open(id: string) {
    if (task.busy) return;
    setDetail(null);
    setHistory(null);
    setPhoto(null);
    setIntent(null);
    setReason('');
    void task.run((signal) => caseData(gateway, id, signal), acceptCase);
  }
  useEffect(() => {
    if (!photo) return;
    const timer = setTimeout(
      () => setPhoto((current) => (current === photo ? null : current)),
      Math.max(0, photo.expiresAt - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [photo]);
  useEffect(() => {
    const timer = setInterval(() => {
      void run(gateway.access, (value) => {
        if (!value.moderator) reset();
      });
    }, 45000);
    return () => clearInterval(timer);
  }, [gateway, run]);
  return (
    <Screen>
      <AppText variant="title">Moderation</AppText>
      {!allowed && (
        <AppText>
          {task.busy ? 'Checking moderator access…' : 'Moderator access is required.'}
        </AppText>
      )}
      {allowed && (
        <>
          {detail ? (
            <>
              <AppText variant="title">
                {detail.report.kind === 'user' ? 'Account report' : 'Photo report'} · @
                {detail.report.username}
              </AppText>
              <AppText>{detail.report.word}</AppText>
              <AppText>Reason: {detail.report.reason}</AppText>
              <AppText>{detail.report.details || 'No additional details.'}</AppText>
              <AppText>
                Status: {detail.report.status} ·{' '}
                {new Date(detail.report.createdAt).toLocaleString()}
              </AppText>
              <AppText>
                Public removal: {detail.removed ? 'Yes' : 'No'} · Account restricted:{' '}
                {detail.restricted ? 'Yes' : 'No'}
              </AppText>
              {photo ? (
                <Image
                  key={`${photo.uri}:${photo.expiresAt}`}
                  source={{ uri: photo.uri, cache: 'reload' }}
                  style={{ width: '100%', height: 260 }}
                  accessibilityLabel="Reported photo"
                  onError={() => setPhoto((current) => (current === photo ? null : current))}
                />
              ) : (
                <AppText>Photo unavailable or preview expired.</AppText>
              )}
              <Button
                label="Reload case and photo"
                disabled={task.busy}
                onPress={() => open(detail.report.id)}
              />
              {!intent ? (
                <>
                  <FormField
                    label="Moderation reason (optional)"
                    value={reason}
                    onChangeText={setReason}
                    maxLength={500}
                    multiline
                    editable={!task.busy}
                  />
                  {moderationActions.map((action) => (
                    <Button
                      key={action.value}
                      label={action.label}
                      disabled={
                        task.busy ||
                        (action.value.endsWith('submission') && !detail.submissionExists) ||
                        (action.value.endsWith('user') && !detail.userExists)
                      }
                      onPress={() =>
                        setIntent({ action: action.value, requestId: randomUUID(), reason })
                      }
                    />
                  ))}
                </>
              ) : (
                <>
                  <AppText>
                    Confirm: {moderationActions.find((a) => a.value === intent.action)?.label}?
                  </AppText>
                  <AppText>{intent.reason || 'No additional reason.'}</AppText>
                  <AppText>This action will be recorded in the moderation audit history.</AppText>
                  <Button
                    label="Confirm moderation action"
                    loading={task.busy}
                    onPress={() =>
                      void task.run(
                        async (signal) => {
                          await gateway.moderate(
                            detail.report.id,
                            intent.action,
                            intent.requestId,
                            intent.reason,
                            signal,
                          );
                          return caseData(gateway, detail.report.id, signal);
                        },
                        (value) => {
                          setIntent(null);
                          acceptCase(value);
                        },
                      )
                    }
                  />
                  <Button
                    label="Cancel action"
                    disabled={task.busy}
                    onPress={() => setIntent(null)}
                  />
                </>
              )}
              <AppText variant="title">Audit history</AppText>
              {history?.items.length === 0 && <AppText>No moderation actions yet.</AppText>}
              {history?.items.map((event) => (
                <AppText key={event.id}>
                  {new Date(event.createdAt).toLocaleString()} · {event.action} · Moderator{' '}
                  {event.moderatorId}
                  {event.reason ? ` · ${event.reason}` : ''}
                </AppText>
              ))}
              {history?.hasMore && (
                <Button
                  label="Older audit events"
                  disabled={task.busy}
                  onPress={() =>
                    void task.run(
                      (signal) =>
                        gateway.history(detail.report.id, history.items.at(-1)?.id ?? null, signal),
                      setHistory,
                    )
                  }
                />
              )}
              <Button
                label="Back to reports"
                disabled={task.busy}
                onPress={() => loadQueue(status, null)}
              />
            </>
          ) : (
            <>
              <ChoiceField
                label="Report status"
                value={status}
                options={['open', 'resolved', 'dismissed'].map((value) => ({
                  value,
                  label: value,
                }))}
                disabled={task.busy}
                onChange={(value) => {
                  if (isReportStatus(value)) loadQueue(value, null);
                }}
              />
              {queue?.items.length === 0 && <AppText>No reports on this page.</AppText>}
              {queue?.items.map((report) => (
                <Button
                  key={report.id}
                  label={`Review ${report.kind} report: @${report.username} · ${report.word} · ${report.reason}`}
                  disabled={task.busy}
                  onPress={() => open(report.id)}
                />
              ))}
              {queue?.hasMore && (
                <Button
                  label="Next reports"
                  disabled={task.busy}
                  onPress={() => {
                    const last = queue.items.at(-1);
                    if (last) loadQueue(status, { time: last.createdAt, id: last.id });
                  }}
                />
              )}
            </>
          )}
        </>
      )}
      {task.error && <AppText accessibilityRole="alert">{task.error}</AppText>}
      <Button label="Refresh moderation" loading={task.busy} onPress={refresh} />
      <Button label="Back to Profile" onPress={() => router.replace('/(tabs)/profile')} />
    </Screen>
  );
}
