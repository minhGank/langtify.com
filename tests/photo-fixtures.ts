import type { AssignmentPhoto, PhotoGateway, Submission } from '@/services/submissions';
import type { DraftStore } from '@/features/photos/use-assignment-photo';
export const photoUser = '45000000-0000-4000-8000-000000000001';
export const photoAssignment = '45000000-0000-4000-8000-000000000002';
export function makeSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: '45000000-0000-4000-8000-000000000003',
    user_id: photoUser,
    daily_challenge_word_id: photoAssignment,
    daily_challenge_id: '45000000-0000-4000-8000-000000000004',
    concept_id: 'concept',
    vocabulary_term_id: 'target',
    reference_term_id: 'reference',
    target_term: 'la fenêtre',
    reference_term: 'window',
    storage_path: `${photoUser}/45000000-0000-4000-8000-000000000003.jpg`,
    status: 'pending',
    visibility: 'private',
    created_at: '2026-09-12T12:00:00Z',
    updated_at: '2026-09-12T12:00:00Z',
    expires_at: '2026-09-13T12:00:00Z',
    submitted_at: null,
    deleted_at: null,
    ...overrides,
  };
}
export function photoFixture(submission: Submission | null = null) {
  let saved: AssignmentPhoto = {
    assignmentId: photoAssignment,
    targetTerm: 'la fenêtre',
    referenceTerm: 'window',
    localDate: '2026-09-12',
    timezone: 'UTC',
    submission,
  };
  let uploaded = submission?.status === 'completed';
  const gateway = {
    load: jest.fn(async () => saved),
    reserve: jest.fn(async () => {
      saved = { ...saved, submission: saved.submission ?? makeSubmission() };
      return saved.submission!;
    }),
    preview: jest.fn(async (): Promise<string | null> =>
      uploaded ? 'https://example.test/signed-photo' : null,
    ),
    upload: jest.fn(async () => {
      uploaded = true;
    }),
    finalize: jest.fn(async (_id: string, visibility: 'private' | 'public') => {
      const row = makeSubmission({
        status: 'completed',
        submitted_at: '2026-09-12T13:00:00Z',
        visibility,
      });
      saved = { ...saved, submission: row };
      return row;
    }),
    visibility: jest.fn(async (_id: string, visibility: 'private' | 'public') => {
      const row = makeSubmission({
        status: 'completed',
        submitted_at: '2026-09-12T13:00:00Z',
        visibility,
      });
      saved = { ...saved, submission: row };
      return row;
    }),
    beginDelete: jest.fn(async () => {
      const row = makeSubmission({ status: 'deleting' });
      saved = { ...saved, submission: row };
      return row;
    }),
    removeObject: jest.fn(async () => {
      uploaded = false;
    }),
    finishDelete: jest.fn(async () => {
      saved = { ...saved, submission: null };
      return makeSubmission({ status: 'deleted', deleted_at: '2026-09-12T13:00:00Z' });
    }),
  } satisfies PhotoGateway;
  const drafts = {
    load: jest.fn(async (): ReturnType<DraftStore['load']> => null),
    remove: jest.fn(),
  } satisfies DraftStore;
  return { gateway, drafts };
}
export const preparedPhoto = {
  uri: 'file:///prepared.jpg',
  bytes: new Uint8Array([255, 216, 255, 217]),
};
