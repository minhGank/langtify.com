import { invalidateServerData, serverScope } from '@/lib/server-cache';
import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/env';
import { requireSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';
import { imageMemory } from '@/lib/image-memory';

export const PHOTO_BUCKET = 'challenge-submissions';
export type Visibility = 'private' | 'public';
export type CaptureKind = 'daily' | 'historical';
export type Submission = Database['public']['Tables']['submissions']['Row'];
export type AssignmentPhoto = {
  assignmentId: string;
  targetTerm: string;
  referenceTerm: string;
  localDate: string;
  currentLocalDate: string;
  timezone: string;
  captureKind: CaptureKind;
  canCapture: boolean;
  submission: Submission | null;
};
export type UnfinishedPhoto = { assignmentId: string; targetTerm: string };
export async function listUnfinishedPhotos(
  userId: string,
  token: string,
): Promise<UnfinishedPhoto[]> {
  const { data, error } = await requireSupabase()
    .from('submissions')
    .select('user_id,daily_challenge_word_id,target_term')
    .eq('user_id', userId)
    .in('status', ['pending', 'deleting'])
    .order('created_at', { ascending: true })
    .limit(100)
    .setHeader('Authorization', `Bearer ${token}`);
  if (error) throw error;
  return data.map((row) => {
    if (row.user_id !== userId) throw new Error('Photo account changed.');
    return { assignmentId: row.daily_challenge_word_id, targetTerm: row.target_term };
  });
}
export type PhotoGateway = {
  cacheKey?: string;
  cachedPreview?: (submission: Submission) => string | null;
  load: (signal?: AbortSignal) => Promise<AssignmentPhoto>;
  canChooseLibraryPhoto: (signal?: AbortSignal) => Promise<boolean>;
  reserve: () => Promise<Submission>;
  preview: (submission: Submission, signal?: AbortSignal) => Promise<string | null>;
  upload: (submission: Submission, bytes: Uint8Array) => Promise<void>;
  finalize: (id: string, visibility: Visibility) => Promise<Submission>;
  visibility: (id: string, visibility: Visibility) => Promise<Submission>;
  beginDelete: (id: string) => Promise<Submission>;
  removeObject: (submission: Submission) => Promise<void>;
  finishDelete: (id: string) => Promise<Submission>;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid photo response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid photo response.');
  return value;
}
function captureKind(value: unknown): CaptureKind {
  if (value !== 'daily' && value !== 'historical') throw new Error('Invalid photo response.');
  return value;
}
export function parseSubmission(value: unknown, userId: string, assignmentId: string): Submission {
  const s = record(value);
  if (
    s.user_id !== userId ||
    s.daily_challenge_word_id !== assignmentId ||
    s.storage_path !== `${userId}/${text(s.id)}.jpg` ||
    !['pending', 'completed', 'deleting', 'deleted'].includes(text(s.status)) ||
    !['private', 'public'].includes(text(s.visibility))
  )
    throw new Error('Photo account changed.');
  const nullableText = (value: unknown) => (value === null ? null : text(value));
  return {
    capture_kind: captureKind(s.capture_kind),
    id: text(s.id),
    user_id: userId,
    daily_challenge_word_id: assignmentId,
    daily_challenge_id: text(s.daily_challenge_id),
    concept_id: text(s.concept_id),
    vocabulary_term_id: text(s.vocabulary_term_id),
    reference_term_id: text(s.reference_term_id),
    target_term: text(s.target_term),
    reference_term: text(s.reference_term),
    storage_path: text(s.storage_path),
    visibility: text(s.visibility),
    status: text(s.status),
    created_at: text(s.created_at),
    updated_at: text(s.updated_at),
    expires_at: text(s.expires_at),
    submitted_at: nullableText(s.submitted_at),
    deleted_at: nullableText(s.deleted_at),
  };
}
export function parseAssignmentPhoto(
  data: Json,
  userId: string,
  assignmentId: string,
  intent?: CaptureKind,
): AssignmentPhoto {
  const result = record(data),
    assignment = record(result.assignment),
    challenge = record(result.challenge);
  if (
    assignment.id !== assignmentId ||
    assignment.daily_challenge_id !== challenge.id ||
    challenge.user_id !== userId ||
    assignment.replaced_at !== null
  )
    throw new Error('Photo account changed.');
  text(challenge.id);
  text(result.current_local_date);
  if (
    typeof result.can_capture_daily !== 'boolean' ||
    typeof result.can_capture_historical !== 'boolean' ||
    (result.can_capture_daily && result.can_capture_historical)
  )
    throw new Error('Invalid photo response.');
  const submission =
    result.submission === null ? null : parseSubmission(result.submission, userId, assignmentId);
  const kind = submission
    ? captureKind(submission.capture_kind)
    : (intent ?? (result.can_capture_historical ? 'historical' : 'daily'));
  return {
    assignmentId,
    targetTerm: text(assignment.target_term),
    referenceTerm: text(assignment.reference_term),
    localDate: text(challenge.local_challenge_date),
    currentLocalDate: text(result.current_local_date),
    timezone: text(challenge.timezone),
    captureKind: kind,
    canCapture:
      (!intent || intent === kind) &&
      (kind === 'historical' ? result.can_capture_historical : result.can_capture_daily) &&
      submission?.status !== 'completed' &&
      submission?.status !== 'deleting',
    submission,
  };
}
export function photoGateway(
  userId: string,
  assignmentId: string,
  token: string,
  intent?: CaptureKind,
): PhotoGateway {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  // A separate non-persisting client pins ALL Storage/RPC requests to this account.
  // Never let a later sign-in on the shared Auth client change an upload's owner.
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const bucket = client.storage.from(PHOTO_BUCKET);
  const memory = imageMemory(serverScope(userId, token), 'owner', [
    'vocabulary',
    'unfinished-photos',
  ]);
  let knownKind = intent;
  let belongsToCurrentDate = false;
  const checked = (data: unknown) => {
    const parsed = parseSubmission(data, userId, assignmentId);
    knownKind = captureKind(parsed.capture_kind);
    return parsed;
  };
  const load = async (signal?: AbortSignal) => {
    let request = client.rpc('get_assignment_photo', { assignment_id: assignmentId });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw error;
    const parsed = parseAssignmentPhoto(data, userId, assignmentId, intent);
    knownKind = parsed.captureKind;
    belongsToCurrentDate = parsed.localDate === parsed.currentLocalDate;
    return parsed;
  };
  // Late photo work may settle after an account switch. Invalidate only its
  // originating session, never the new user's projections.
  const invalidate = (tags: readonly string[], options: { discard?: boolean } = {}) =>
    invalidateServerData(tags, { ...options, scope: serverScope(userId, token) });
  const challengeTags = () =>
    knownKind === 'historical' && !belongsToCurrentDate ? [] : ['challenge'];
  return {
    cacheKey: `${serverScope(userId, token)}:assignment:${assignmentId}:${intent ?? 'auto'}`,
    cachedPreview(submission) {
      return memory.cached([checked(submission).id])[submission.id] ?? null;
    },
    load,
    async canChooseLibraryPhoto(signal) {
      // One owner read computes current-day / Past Words admission on the server.
      // Route intent cannot turn a current word into historical reward authority.
      return (await load(signal)).canCapture;
    },
    async reserve() {
      const context = await load();
      if (context.submission?.status === 'completed') return context.submission;
      if (!context.canCapture) throw new Error('photo_capture_unavailable');
      const { data, error } = await client.rpc(
        context.captureKind === 'historical'
          ? 'reserve_historical_submission'
          : 'reserve_submission',
        {
          assignment_id: assignmentId,
        },
      );
      invalidate(['past-words', 'unfinished-photos', ...challengeTags()]);
      if (error) throw error;
      const reserved = checked(data);
      if (reserved.capture_kind !== context.captureKind) throw new Error('Photo account changed.');
      return reserved;
    },
    async preview(submission, signal) {
      if (signal?.aborted) throw new Error('Photo request cancelled.');
      const s = checked(submission);
      const cached = memory.cached([s.id])[s.id];
      if (cached) return cached;
      const started = performance.now();
      const { data, error } = await client.functions.invoke('photo-authority', {
        body: { action: 'preview', submissionId: s.id },
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) throw new Error('Photo request cancelled.');
      if (error) throw error;
      const result = record(data);
      if (result.signedPath === null) {
        await memory.resolve({ [s.id]: null });
        return null;
      }
      const path = text(result.signedPath);
      if (!path.startsWith(`/storage/v1/object/sign/${PHOTO_BUCKET}/${s.storage_path}?token=`))
        throw new Error('Invalid photo response.');
      const photos = await memory.resolve(
        { [s.id]: `${config.url}${path}` },
        signal,
        started + 55000,
      );
      return photos[s.id] ?? null;
    },
    async upload(submission, bytes) {
      const s = checked(submission);
      const { error } = await bucket.upload(s.storage_path, Uint8Array.from(bytes).buffer, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '0',
      });
      if (error) throw error;
    },
    async finalize(id, visibility) {
      const { data, error } = await client.functions.invoke('photo-authority', {
        body: { action: 'finalize', submissionId: id, visibility },
      });
      invalidate([
        ...challengeTags(),
        'progress',
        'vocabulary',
        'past-words',
        'discover',
        'unfinished-photos',
      ]);
      if (error) throw error;
      return checked(record(data).submission);
    },
    async visibility(id, visibility) {
      const { data, error } = await client.rpc('set_submission_visibility', {
        submission_id: id,
        requested_visibility: visibility,
      });
      invalidate(['vocabulary', 'discover', 'inbox'], { discard: true });
      if (error) throw error;
      return checked(data);
    },
    async beginDelete(id) {
      const { data, error } = await client.rpc('begin_submission_deletion', { submission_id: id });
      invalidate([...challengeTags(), 'past-words', 'unfinished-photos']);
      invalidate(['vocabulary', 'discover', 'inbox'], { discard: true });
      if (error) throw error;
      return checked(data);
    },
    async removeObject(submission) {
      const { error } = await bucket.remove([checked(submission).storage_path]);
      if (error) throw error;
    },
    async finishDelete(id) {
      const { data, error } = await client.rpc('finish_submission_deletion', { submission_id: id });
      invalidate([
        ...challengeTags(),
        'progress',
        'vocabulary',
        'past-words',
        'discover',
        'unfinished-photos',
      ]);
      if (error) throw error;
      return checked(data);
    },
  };
}
