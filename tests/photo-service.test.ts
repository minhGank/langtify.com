import { parseAssignmentPhoto, parseSubmission, photoGateway } from '@/services/submissions';
import { makeSubmission, photoAssignment, photoUser } from './photo-fixtures';
const mockRpc = jest.fn(),
  mockUpload = jest.fn(),
  mockInvoke = jest.fn(),
  mockCreate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('@/lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://example.supabase.co', key: 'sb_publishable_fixture' } },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReturnValue({
    rpc: mockRpc,
    storage: { from: () => ({ upload: mockUpload }) },
    functions: { invoke: mockInvoke },
  });
});
it('pins Storage and RPCs to the submitting token without persisting another Auth session', async () => {
  mockRpc.mockResolvedValue({ data: makeSubmission(), error: null });
  const gateway = photoGateway(photoUser, photoAssignment, 'captured-test-token');
  await gateway.reserve();
  expect(mockRpc).toHaveBeenCalledWith('reserve_submission', { assignment_id: photoAssignment });
  const options = mockCreate.mock.calls[0][2];
  expect(await options.accessToken()).toBe('captured-test-token');
  expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
});
it('uploads an ArrayBuffer with no overwrite or user-controlled path', async () => {
  mockUpload.mockResolvedValue({ error: null });
  await photoGateway(photoUser, photoAssignment, 'test').upload(
    makeSubmission(),
    new Uint8Array([1, 2]),
  );
  expect(mockUpload).toHaveBeenCalledWith(makeSubmission().storage_path, expect.any(ArrayBuffer), {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '0',
  });
});
it('rejects another account, assignment, or invented storage path in server responses', () => {
  expect(() =>
    parseSubmission(makeSubmission({ user_id: 'other' }), photoUser, photoAssignment),
  ).toThrow('account');
  expect(() =>
    parseSubmission(
      makeSubmission({ daily_challenge_word_id: 'other' }),
      photoUser,
      photoAssignment,
    ),
  ).toThrow('account');
  expect(() =>
    parseSubmission(
      makeSubmission({ storage_path: 'other/photo.jpg' }),
      photoUser,
      photoAssignment,
    ),
  ).toThrow('account');
  expect(() =>
    parseAssignmentPhoto(
      {
        assignment: { id: photoAssignment, daily_challenge_id: 'c', replaced_at: null },
        challenge: { id: 'c', user_id: 'other' },
        submission: null,
      },
      photoUser,
      photoAssignment,
    ),
  ).toThrow('account');
});

it('uses the trusted function for preview lifetime and image finalization with no caller path or TTL', async () => {
  const gateway = photoGateway(photoUser, photoAssignment, 'token');
  const path = `/storage/v1/object/sign/challenge-submissions/${makeSubmission().storage_path}?token=fixture`;
  mockInvoke.mockResolvedValueOnce({ data: { signedPath: path }, error: null });
  expect(await gateway.preview(makeSubmission())).toBe(`https://example.supabase.co${path}`);
  expect(mockInvoke).toHaveBeenLastCalledWith('photo-authority', {
    body: { action: 'preview', submissionId: makeSubmission().id },
  });
  mockInvoke.mockResolvedValueOnce({ data: { submission: makeSubmission() }, error: null });
  await gateway.finalize(makeSubmission().id, 'private');
  expect(mockInvoke).toHaveBeenLastCalledWith('photo-authority', {
    body: { action: 'finalize', submissionId: makeSubmission().id, visibility: 'private' },
  });
});
