import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { ChoiceField } from '@/components/ui/choice-field';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useServerQuery } from '@/hooks/use-server-query';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { socialGateway, type Comment, type CommentCursor } from '@/services/social';
import {
  isReportReason,
  reportReasons,
  SafetyUnavailable,
  type ReportReason,
  type SafetyIdentity,
} from '@/features/safety/model';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { commentCache, discardPublicData, socialChanged } from './cache';

export function Comments({
  identity,
  submissionId,
  openProfile,
  unavailable,
}: {
  identity: SafetyIdentity;
  submissionId: string;
  openProfile: (profileId: string) => void;
  unavailable: () => void;
}) {
  const { colors } = useAppTheme();
  const [body, setBody] = useState('');
  const [attemptedBody, setAttemptedBody] = useState('');
  const [cursor, setCursor] = useState<CommentCursor | null>(null);
  const [selected, setSelected] = useState<Comment | null>(null);
  const intent = useRef<{ body: string; id: string } | null>(null);
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const entry = useMemo(
    () =>
      commentCache.entry(
        `${serverScope(identity.userId, identity.token)}:comments:${submissionId}:${cursor?.time ?? ''}:${cursor?.id ?? ''}`,
        ['comments', `comments:${submissionId}`],
      ),
    [identity, submissionId, cursor],
  );
  const load = useCallback(
    (signal: AbortSignal) => gateway.comments(submissionId, cursor, signal),
    [gateway, submissionId, cursor],
  );
  const discardOnError = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof SafetyUnavailable)) return false;
      discardPublicData(identity, entry);
      return true;
    },
    [identity, entry],
  );
  const query = useServerQuery(entry, load, { staleTime: 30000, discardOnError });
  const task = useSafetyTask(
    () => setSelected(null),
    undefined,
    () => {
      discardPublicData(identity);
      unavailable();
    },
  );
  const refresh = () => {
    if (cursor) setCursor(null);
    else void query.refresh();
  };
  const reconcile = (deletedId?: string) => {
    const scope = serverScope(identity.userId, identity.token);
    if (deletedId)
      commentCache.update((key, page) =>
        key.startsWith(`${scope}:comments:${submissionId}:`)
          ? { ...page, items: page.items.filter((comment) => comment.id !== deletedId) }
          : page,
      );
    // Keep the loaded conversation visible while the affected page reconciles.
    // Creation receipts intentionally expose no client-fabricated comment row.
    invalidateServerData([`comments:${submissionId}`], { scope });
  };
  const send = () => {
    const normalized = body.trim();
    if (!normalized || [...normalized].length > 500) return;
    if (!intent.current || intent.current.body !== normalized)
      intent.current = { body: normalized, id: Crypto.randomUUID() };
    const pending = intent.current;
    setAttemptedBody(normalized);
    void task.run(
      async (signal) => {
        try {
          await gateway.createComment(submissionId, pending.body, pending.id, signal);
        } catch (error) {
          if (!signal.aborted) reconcile();
          throw error;
        }
      },
      () => {
        setBody('');
        intent.current = null;
        setCursor(null);
        reconcile();
      },
    );
  };
  return (
    <View style={[styles.content, { borderTopColor: colors.border }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">Comments</AppText>
          <AppText variant="caption">Newest first</AppText>
        </View>
      </View>
      <FormField
        label="Add a comment"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={500}
        editable={!task.busy}
        placeholder="Join the conversation"
        hint={`${[...body].length} / 500`}
      />
      <Button
        label={task.error && attemptedBody === body.trim() ? 'Retry comment' : 'Post comment'}
        loading={task.busy}
        disabled={!body.trim()}
        onPress={send}
      />
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {task.error}
        </AppText>
      )}
      {query.loading && !query.data && (
        <ActivityIndicator accessibilityLabel="Loading comments" color={colors.primary} />
      )}
      {query.error && (
        <>
          <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
            Comments could not be loaded.
          </AppText>
          <Button label="Retry comments" variant="secondary" onPress={refresh} />
        </>
      )}
      {query.data?.items.length === 0 && <AppText variant="caption">No comments yet.</AppText>}
      {query.data?.items.map((comment) => (
        <View key={comment.id} style={[styles.comment, { borderBottomColor: colors.border }]}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View @${comment.username}`}
              onPress={() => openProfile(comment.profileId)}
              style={styles.author}
            >
              <AppText variant="label">@{comment.username}</AppText>
              <AppText variant="caption">
                {new Date(comment.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </AppText>
            </Pressable>
            <IconButton
              name="ellipsis-horizontal"
              label={`Options for comment by @${comment.username}`}
              onPress={() => setSelected(comment)}
            />
          </View>
          <AppText>{comment.body}</AppText>
        </View>
      ))}
      {query.data?.hasMore && (
        <Button
          label="Older comments"
          variant="secondary"
          disabled={query.loading}
          onPress={() => {
            const last = query.data?.items.at(-1);
            if (last) setCursor({ time: last.createdAt, id: last.id });
          }}
        />
      )}
      {cursor && (
        <Button label="Back to newest comments" variant="ghost" onPress={() => setCursor(null)} />
      )}
      {selected && (
        <CommentActions
          key={`${identity.userId}:${identity.token}:${selected.id}`}
          identity={identity}
          comment={selected}
          close={() => setSelected(null)}
          changed={() => {
            reconcile(selected.id);
            setSelected(null);
          }}
          blocked={() => {
            setSelected(null);
            socialChanged('block');
            unavailable();
          }}
        />
      )}
    </View>
  );
}
function CommentActions({
  identity,
  comment,
  close,
  changed,
  blocked,
}: {
  identity: SafetyIdentity;
  comment: Comment;
  close: () => void;
  changed: () => void;
  blocked: () => void;
}) {
  const { colors } = useAppTheme();
  const gateway = useMemo(() => socialGateway(identity), [identity]);
  const task = useSafetyTask(close, undefined, blocked);
  const [mode, setMode] = useState<'menu' | 'delete' | 'report' | 'block' | 'done'>('menu');
  const [reason, setReason] = useState<ReportReason>('harassment_hate');
  const [details, setDetails] = useState('');
  return (
    <Sheet
      visible
      title={
        mode === 'report'
          ? 'Report comment'
          : mode === 'done'
            ? 'Report received'
            : 'Comment options'
      }
      onClose={close}
    >
      <AppText variant="caption">@{comment.username}</AppText>
      {mode === 'menu' &&
        (comment.isOwn ? (
          <Button label="Delete comment" variant="danger" onPress={() => setMode('delete')} />
        ) : (
          <>
            <Button label="Report comment" variant="secondary" onPress={() => setMode('report')} />
            <Button label="Block commenter" variant="ghost" onPress={() => setMode('block')} />
          </>
        ))}
      {mode === 'delete' && (
        <>
          <AppText>Delete this comment?</AppText>
          <Button
            label="Confirm delete comment"
            variant="danger"
            loading={task.busy}
            onPress={() =>
              void task.run((signal) => gateway.deleteComment(comment.id, signal), changed)
            }
          />
        </>
      )}
      {mode === 'block' && (
        <>
          <AppText>
            Block @{comment.username}? You will stop seeing each other’s public content.
          </AppText>
          <Button
            label="Confirm block"
            variant="danger"
            loading={task.busy}
            onPress={() =>
              void task.run((signal) => gateway.block(comment.profileId, signal), blocked)
            }
          />
        </>
      )}
      {mode === 'report' && (
        <>
          <ChoiceField
            label="Report reason"
            value={reason}
            options={reportReasons.filter((r) => r.value !== 'inappropriate')}
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
          />
          <AppText variant="caption">
            Your report is private. The commenter will not see who reported it.
          </AppText>
          <Button
            label="Submit report"
            loading={task.busy}
            onPress={() =>
              void task.run(
                (signal) => gateway.reportComment(comment.id, reason, details, signal),
                () => setMode('done'),
              )
            }
          />
        </>
      )}
      {mode === 'done' && <AppText>Your report has been received.</AppText>}
      {task.error && (
        <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
          {task.error}
        </AppText>
      )}
      <Button label={mode === 'done' ? 'Done' : 'Cancel'} variant="ghost" onPress={close} />
    </Sheet>
  );
}
const styles = StyleSheet.create({
  content: { gap: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  comment: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 16, gap: 4 },
  author: { minHeight: 44, flex: 1, justifyContent: 'center', gap: 2 },
});
