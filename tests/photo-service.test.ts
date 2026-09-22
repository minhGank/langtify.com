import { parseAssignmentPhoto, parseSubmission, photoGateway } from '@/services/submissions';
import { makeSubmission, photoAssignment, photoUser } from './photo-fixtures';
import {
  clearServerData,
  createServerCache,
  invalidateServerData,
  serverScope,
} from '@/lib/server-cache';
const mockRpc = jest.fn(),
  mockUpload = jest.fn(),
  mockInvoke = jest.fn(),
  mockCreate = jest.fn();
const mockImageFetch = jest.fn();
jest.mock('@/lib/http', () => ({ boundedFetch: (...args: unknown[]) => mockImageFetch(...args) }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('@/lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://example.supabase.co', key: 'sb_publishable_fixture' } },
}));
beforeEach(() => {
  jest.clearAllMocks();
  clearServerData();
  mockImageFetch.mockReset().mockResolvedValue({
    ok: true,
    headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: async () => new Uint8Array([255, 216, 255, 217]).buffer,
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(mockImageFetch);
  mockCreate.mockReturnValue({
    rpc: mockRpc,
    storage: { from: () => ({ upload: mockUpload }) },
    functions: { invoke: mockInvoke },
  });
});
afterEach(() => jest.restoreAllMocks());
it('pins Storage and RPCs to the submitting token without persisting another Auth session', async () => {
  mockRpc.mockResolvedValueOnce({ data: libraryEligibilityRows().photo, error: null });
  mockRpc.mockResolvedValueOnce({ data: makeSubmission(), error: null });
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
  expect(await gateway.preview(makeSubmission())).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(mockImageFetch).toHaveBeenCalledWith(
    `https://example.supabase.co${path}`,
    expect.any(Object),
  );
  expect(mockInvoke).toHaveBeenLastCalledWith('photo-authority', {
    body: { action: 'preview', submissionId: makeSubmission().id },
  });
  mockInvoke.mockResolvedValueOnce({ data: { submission: makeSubmission() }, error: null });
  await gateway.finalize(makeSubmission().id, 'private');
  expect(mockInvoke).toHaveBeenLastCalledWith('photo-authority', {
    body: { action: 'finalize', submissionId: makeSubmission().id, visibility: 'private' },
  });
});
it('reuses downloaded owner pixels until explicit invalidation and never exposes a signed URL', async () => {
  const gateway = photoGateway(photoUser, photoAssignment, 'token');
  const submission = makeSubmission();
  const path = `/storage/v1/object/sign/challenge-submissions/${submission.storage_path}?token=fixture`;
  mockInvoke.mockResolvedValue({ data: { signedPath: path }, error: null });
  expect(await gateway.preview(submission)).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(await gateway.preview(submission)).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockImageFetch).toHaveBeenCalledTimes(1);
  invalidateServerData(['vocabulary'], { discard: true, scope: serverScope(photoUser, 'token') });
  mockInvoke.mockResolvedValueOnce({ data: { signedPath: null }, error: null });
  expect(await gateway.preview(submission)).toBeNull();
  expect(gateway.cachedPreview?.(submission)).toBeNull();
  expect(mockImageFetch).toHaveBeenCalledTimes(1);
});
it('does not download a signed capability that arrived after its access window', async () => {
  const now = jest.spyOn(performance, 'now');
  now.mockReturnValue(0);
  const gateway = photoGateway(photoUser, photoAssignment, 'token');
  mockInvoke.mockImplementationOnce(async () => {
    now.mockReturnValue(55001);
    return {
      data: {
        signedPath: `/storage/v1/object/sign/challenge-submissions/${makeSubmission().storage_path}?token=expired`,
      },
      error: null,
    };
  });
  try {
    await expect(gateway.preview(makeSubmission())).rejects.toThrow();
    expect(mockImageFetch).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});

it('does not download a preview response after its owner request was cancelled', async () => {
  const gateway = photoGateway(photoUser, photoAssignment, 'token');
  const controller = new AbortController();
  mockInvoke.mockImplementationOnce(async () => {
    controller.abort();
    return {
      data: {
        signedPath: `/storage/v1/object/sign/challenge-submissions/${makeSubmission().storage_path}?token=late`,
      },
      error: null,
    };
  });
  await expect(gateway.preview(makeSubmission(), controller.signal)).rejects.toThrow('cancelled');
  expect(mockImageFetch).not.toHaveBeenCalled();
});

function libraryEligibilityRows() {
  const challengeId = makeSubmission().daily_challenge_id;
  return {
    photo: {
      assignment: {
        id: photoAssignment,
        daily_challenge_id: challengeId,
        replaced_at: null as string | null,
        target_term: 'la fenêtre',
        reference_term: 'window',
      },
      challenge: {
        id: challengeId,
        user_id: photoUser,
        local_challenge_date: '2026-03-08',
        timezone: 'America/Toronto',
      },
      current_local_date: '2026-03-08',
      can_capture_daily: true,
      can_capture_historical: false,
      submission: null as ReturnType<typeof makeSubmission> | null,
    },
  };
}
function mockLibraryEligibility(rows = libraryEligibilityRows()) {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'get_assignment_photo') return { data: rows.photo, error: null };
    throw new Error('Unexpected eligibility RPC.');
  });
  return rows;
}

it('uses one server-owned eligibility read without a caller date or challenge override', async () => {
  mockLibraryEligibility();
  await expect(
    photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(),
  ).resolves.toBe(true);
  expect(mockRpc.mock.calls).toEqual([
    ['get_assignment_photo', { assignment_id: photoAssignment }],
  ]);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockInvoke).not.toHaveBeenCalled();
});

it.each(['unavailable', 'completed', 'deleting'])(
  'does not admit gallery selection for %s',
  async (reason) => {
    const rows = libraryEligibilityRows();
    if (reason === 'unavailable') rows.photo.can_capture_daily = false;
    if (reason === 'completed' || reason === 'deleting')
      rows.photo.submission = makeSubmission({ status: reason });
    mockLibraryEligibility(rows);
    await expect(
      photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(),
    ).resolves.toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  },
);

it.each([
  'foreign photo owner',
  'different assignment',
  'replaced word',
  'wrong assignment challenge',
])('rejects invalid gallery admission identity: %s', async (reason) => {
  const rows = libraryEligibilityRows();
  if (reason === 'foreign photo owner') rows.photo.challenge.user_id = 'another-user';
  if (reason === 'different assignment') rows.photo.assignment.id = 'another-assignment';
  if (reason === 'replaced word') rows.photo.assignment.replaced_at = '2026-03-08T01:00:00Z';
  if (reason === 'wrong assignment challenge')
    rows.photo.assignment.daily_challenge_id = 'another-challenge';
  mockLibraryEligibility(rows);
  await expect(
    photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(),
  ).rejects.toThrow('account changed');
});

it('fails closed when the authoritative gallery read fails', async () => {
  mockRpc.mockResolvedValue({ data: null, error: new Error('offline') });
  await expect(
    photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(),
  ).rejects.toThrow('offline');
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockInvoke).not.toHaveBeenCalled();
});

it.each(['missing date', 'empty challenge', 'contradictory flags'])(
  'rejects malformed server eligibility: %s',
  async (reason) => {
    const rows = libraryEligibilityRows();
    if (reason === 'missing date') rows.photo.current_local_date = '';
    if (reason === 'empty challenge') {
      rows.photo.challenge.id = '';
      rows.photo.assignment.daily_challenge_id = '';
    }
    if (reason === 'contradictory flags') rows.photo.can_capture_historical = true;
    mockLibraryEligibility(rows);
    await expect(
      photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(),
    ).rejects.toThrow('Invalid photo response');
  },
);

it('cancels the authoritative gallery admission read', async () => {
  const rows = libraryEligibilityRows();
  const abort = jest.fn(() => Promise.resolve({ data: rows.photo, error: null }));
  mockRpc.mockReturnValue({ abortSignal: abort });
  const controller = new AbortController();
  await expect(
    photoGateway(photoUser, photoAssignment, 'token').canChooseLibraryPhoto(controller.signal),
  ).resolves.toBe(true);
  expect(abort).toHaveBeenCalledWith(controller.signal);
});

it('routes server-eligible historical capture to the same upload pipeline with a dedicated reservation', async () => {
  const rows = libraryEligibilityRows();
  rows.photo.can_capture_daily = false;
  rows.photo.can_capture_historical = true;
  rows.photo.challenge.local_challenge_date = '2026-03-07';
  mockRpc.mockResolvedValueOnce({ data: rows.photo, error: null });
  mockRpc.mockResolvedValueOnce({
    data: makeSubmission({ capture_kind: 'historical' }),
    error: null,
  });
  await expect(
    photoGateway(photoUser, photoAssignment, 'token', 'historical').reserve(),
  ).resolves.toMatchObject({ capture_kind: 'historical' });
  expect(mockRpc).toHaveBeenLastCalledWith('reserve_historical_submission', {
    assignment_id: photoAssignment,
  });
});

it('never lets a route turn a current assignment into historical reward authority', async () => {
  mockLibraryEligibility();
  const gateway = photoGateway(photoUser, photoAssignment, 'token', 'historical');
  await expect(gateway.canChooseLibraryPhoto()).resolves.toBe(false);
  await expect(gateway.reserve()).rejects.toThrow('photo_capture_unavailable');
  expect(mockRpc.mock.calls.every(([name]) => name === 'get_assignment_photo')).toBe(true);
});

it('recovers the immutable daily mode of a reservation admitted before midnight', async () => {
  const rows = libraryEligibilityRows();
  rows.photo.current_local_date = '2026-03-09';
  rows.photo.submission = makeSubmission();
  mockLibraryEligibility(rows);
  await expect(photoGateway(photoUser, photoAssignment, 'token').load()).resolves.toMatchObject({
    captureKind: 'daily',
    canCapture: true,
  });
  await expect(
    photoGateway(photoUser, photoAssignment, 'token', 'historical').load(),
  ).resolves.toMatchObject({ captureKind: 'daily', canCapture: false });
});

it('rejects a reservation returned with a different persisted capture kind', async () => {
  mockRpc.mockResolvedValueOnce({ data: libraryEligibilityRows().photo, error: null });
  mockRpc.mockResolvedValueOnce({
    data: makeSubmission({ capture_kind: 'historical' }),
    error: null,
  });
  await expect(photoGateway(photoUser, photoAssignment, 'token').reserve()).rejects.toThrow(
    'account changed',
  );
});

it('rejects a fabricated capture kind instead of guessing reward semantics', () => {
  expect(() =>
    parseSubmission(makeSubmission({ capture_kind: 'bonus' }), photoUser, photoAssignment),
  ).toThrow('Invalid photo response');
});

it.each([false, true])(
  'historical mutation invalidates Today only when its server date overlaps: %s',
  async (today) => {
    const scope = serverScope(photoUser, 'token');
    const cache = createServerCache<string>({ maxEntries: 3 });
    const own = cache.entry(`${scope}:test-challenge`, ['challenge']);
    const other = cache.entry(`${serverScope('other', 'other-token')}:test-challenge`, [
      'challenge',
    ]);
    await own.read(async () => 'loaded', { staleTime: Infinity });
    await other.read(async () => 'loaded', { staleTime: Infinity });
    const ownRevision = own.getRevision();
    const otherRevision = other.getRevision();
    const rows = libraryEligibilityRows();
    rows.photo.can_capture_daily = false;
    rows.photo.can_capture_historical = true;
    rows.photo.challenge.local_challenge_date = today
      ? rows.photo.current_local_date
      : '2026-03-07';
    rows.photo.submission = makeSubmission({ capture_kind: 'historical' });
    mockLibraryEligibility(rows);
    const gateway = photoGateway(photoUser, photoAssignment, 'token', 'historical');
    await gateway.load();
    mockInvoke.mockResolvedValue({
      data: { submission: makeSubmission({ capture_kind: 'historical', status: 'completed' }) },
      error: null,
    });
    await gateway.finalize(makeSubmission().id, 'private');
    expect(own.getRevision() > ownRevision).toBe(today);
    expect(other.getRevision()).toBe(otherRevision);
  },
);
