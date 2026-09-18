import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { publicConfig } from '@/lib/env';
import { requireSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';

export const PHOTO_BUCKET = 'challenge-submissions';
export type Visibility = 'private' | 'public';
export type Submission = Database['public']['Tables']['submissions']['Row'];
export type AssignmentPhoto = {
  assignmentId: string;
  targetTerm: string;
  referenceTerm: string;
  localDate: string;
  timezone: string;
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
  load: () => Promise<AssignmentPhoto>;
  reserve: () => Promise<Submission>;
  preview: (submission: Submission) => Promise<string | null>;
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
  return {
    assignmentId,
    targetTerm: text(assignment.target_term),
    referenceTerm: text(assignment.reference_term),
    localDate: text(challenge.local_challenge_date),
    timezone: text(challenge.timezone),
    submission:
      result.submission === null ? null : parseSubmission(result.submission, userId, assignmentId),
  };
}
export function photoGateway(userId: string, assignmentId: string, token: string): PhotoGateway {
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
  const checked = (data: unknown) => parseSubmission(data, userId, assignmentId);
  return {
    async load() {
      const { data, error } = await client.rpc('get_assignment_photo', {
        assignment_id: assignmentId,
      });
      if (error) throw error;
      return parseAssignmentPhoto(data, userId, assignmentId);
    },
    async reserve() {
      const { data, error } = await client.rpc('reserve_submission', {
        assignment_id: assignmentId,
      });
      if (error) throw error;
      return checked(data);
    },
    async preview(submission) {
      const s = checked(submission);
      const { data, error } = await client.functions.invoke('photo-authority', {
        body: { action: 'preview', submissionId: s.id },
      });
      if (error) throw error;
      const result = record(data);
      if (result.signedPath === null) return null;
      const path = text(result.signedPath);
      if (!path.startsWith(`/storage/v1/object/sign/${PHOTO_BUCKET}/${s.storage_path}?token=`))
        throw new Error('Invalid photo response.');
      return `${config.url}${path}`;
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
      if (error) throw error;
      return checked(record(data).submission);
    },
    async visibility(id, visibility) {
      const { data, error } = await client.rpc('set_submission_visibility', {
        submission_id: id,
        requested_visibility: visibility,
      });
      if (error) throw error;
      return checked(data);
    },
    async beginDelete(id) {
      const { data, error } = await client.rpc('begin_submission_deletion', { submission_id: id });
      if (error) throw error;
      return checked(data);
    },
    async removeObject(submission) {
      const { error } = await bucket.remove([checked(submission).storage_path]);
      if (error) throw error;
    },
    async finishDelete(id) {
      const { data, error } = await client.rpc('finish_submission_deletion', { submission_id: id });
      if (error) throw error;
      return checked(data);
    },
  };
}
