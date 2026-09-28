import {
  loadOwnedPost,
  openCompletedPost,
  ownedPostEntry,
  postAcknowledgement,
} from '@/features/discover/owned-post-access';
import { router } from 'expo-router';
import { photoFixture, photoUser, photoAssignment, makeSubmission } from './photo-fixtures';

const mockMaybeSingle = jest.fn();
const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  setHeader: jest.fn(),
  abortSignal: jest.fn(),
  maybeSingle: mockMaybeSingle,
};
const mockFrom = jest.fn(() => mockQuery);
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ from: mockFrom }) }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
const identity = { userId: photoUser, token: 'session-A' };
beforeEach(() => {
  jest.clearAllMocks();
  for (const method of [mockQuery.select, mockQuery.eq, mockQuery.setHeader, mockQuery.abortSignal])
    method.mockReturnValue(mockQuery);
});
it('resolves only a matching owner row with the captured Auth token and abort signal', async () => {
  const signal = new AbortController().signal;
  mockMaybeSingle.mockResolvedValue({
    data: { id: makeSubmission().id, user_id: photoUser, daily_challenge_word_id: photoAssignment },
    error: null,
  });
  await expect(loadOwnedPost(identity, makeSubmission().id, signal)).resolves.toEqual({
    assignmentId: photoAssignment,
  });
  expect(mockFrom).toHaveBeenCalledWith('submissions');
  expect(mockQuery.select).toHaveBeenCalledWith('user_id,id,daily_challenge_word_id');
  expect(mockQuery.eq.mock.calls).toEqual([
    ['id', makeSubmission().id],
    ['user_id', photoUser],
  ]);
  expect(mockQuery.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer session-A');
  expect(mockQuery.abortSignal).toHaveBeenCalledWith(signal);
});
it('falls back to controlled public reads for an RLS-hidden row and rejects foreign payloads', async () => {
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(
    loadOwnedPost(identity, makeSubmission().id, new AbortController().signal),
  ).resolves.toEqual({ assignmentId: null });
  mockMaybeSingle.mockResolvedValue({
    data: { id: makeSubmission().id, user_id: 'other', daily_challenge_word_id: photoAssignment },
    error: null,
  });
  await expect(
    loadOwnedPost(identity, makeSubmission().id, new AbortController().signal),
  ).rejects.toThrow('account changed');
});
it('never seeds a different owner or pending row and puts no private photo/XP data in navigation', async () => {
  const fixture = photoFixture(makeSubmission());
  const data = await fixture.gateway.load();
  openCompletedPost(identity, data, true);
  expect(router.replace).not.toHaveBeenCalled();
  const completed = { ...data, submission: makeSubmission({ status: 'completed' }) };
  openCompletedPost({ ...identity, userId: 'other' }, completed, true);
  expect(router.replace).not.toHaveBeenCalled();
  openCompletedPost(identity, completed, false);
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/post',
    params: { submissionId: makeSubmission().id },
  });
  expect(ownedPostEntry(identity, makeSubmission().id).getSnapshot().data).toEqual({
    assignmentId: photoAssignment,
  });
  expect(postAcknowledgement(identity, makeSubmission().id).getSnapshot().data).toBeNull();
});
