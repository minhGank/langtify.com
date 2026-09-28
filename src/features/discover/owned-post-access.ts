import { router } from 'expo-router';
import { createServerCache, serverScope } from '@/lib/server-cache';
import { requireSupabase } from '@/lib/supabase';
import type { AssignmentPhoto } from '@/services/submissions';
import { rememberCompletedAssignment } from '@/features/photos/use-assignment-photo';

type Identity = { userId: string; token: string };
const owners = createServerCache<{ assignmentId: string | null }>({ maxEntries: 24 });
const acknowledgements = createServerCache<number>({ maxEntries: 12 });
export function ownedPostEntry(identity: Identity, id: string) {
  // Ownership/assignment linkage is immutable. Lifecycle reads stay in the
  // photo gateway so its own deletion cannot unmount the operation halfway.
  return owners.entry(`${serverScope(identity.userId, identity.token)}:post-owner:${id}`, []);
}
export function postAcknowledgement(identity: Identity, id: string) {
  return acknowledgements.entry(
    `${serverScope(identity.userId, identity.token)}:photo-added:${id}`,
    ['media'],
  );
}
export async function loadOwnedPost(identity: Identity, id: string, signal: AbortSignal) {
  // Existing owner-only RLS: a public viewer gets no row here and continues to
  // the existing Discover projection. Never broaden raw table access.
  const { data, error } = await requireSupabase()
    .from('submissions')
    .select('user_id,id,daily_challenge_word_id')
    .eq('id', id)
    .eq('user_id', identity.userId)
    .setHeader('Authorization', `Bearer ${identity.token}`)
    .abortSignal(signal)
    .maybeSingle();
  if (error) throw error;
  if (data && (data.user_id !== identity.userId || data.id !== id))
    throw new Error('Photo account changed.');
  return { assignmentId: data?.daily_challenge_word_id ?? null };
}
export function openCompletedPost(identity: Identity, data: AssignmentPhoto, celebrate: boolean) {
  const saved = data.submission;
  if (
    !saved ||
    saved.status !== 'completed' ||
    saved.user_id !== identity.userId ||
    saved.daily_challenge_word_id !== data.assignmentId
  )
    return;
  ownedPostEntry(identity, saved.id).set({ assignmentId: data.assignmentId });
  rememberCompletedAssignment(identity, data);
  if (celebrate) postAcknowledgement(identity, saved.id).set(performance.now() + 10000);
  // Replace removes capture/preview from Back history. Only an identifier enters
  // Router; media, XP and acknowledgement authority remain session-local.
  router.replace({ pathname: '/post', params: { submissionId: saved.id } });
}
