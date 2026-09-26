import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AvatarEditor } from '@/features/profile/avatar-editor';
import { ProfileAvatar } from '@/features/profile/profile-avatar';
import {
  clearServerData,
  createServerCache,
  invalidateServerData,
  serverScope,
} from '@/lib/server-cache';
import { parseAvatarPreviews, parseAvatarState } from '@/services/avatars';
import { feedback } from '@/lib/haptics';
jest.mock('@/lib/haptics', () => ({
  feedback: { confirm: jest.fn(), success: jest.fn() },
}));

const owner = 'a9000000-0000-4000-8000-000000000001';
const id = 'a9000000-0000-4000-8000-000000000002';
const identity = { userId: owner, token: 'token-a' };
const prepared = { bytes: new Uint8Array([1, 2, 3]), uri: 'data:image/jpeg;base64,AQID' };
const mockApi = {
  load: jest.fn(),
  reserve: jest.fn(),
  upload: jest.fn(),
  finalize: jest.fn(),
  remove: jest.fn(),
  previews: jest.fn(),
};
const mockPick = jest.fn();
const mockImageFetch = jest.fn();
jest.mock('@/lib/http', () => ({ boundedFetch: (...args: unknown[]) => mockImageFetch(...args) }));
jest.mock('@/services/avatars', () => ({
  ...jest.requireActual('@/services/avatars'),
  avatarGateway: () => mockApi,
}));
jest.mock('@/features/profile/prepare-avatar', () => ({
  pickAvatar: (current: () => boolean) => mockPick(current),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'a9000000-0000-4000-8000-000000000003' }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
beforeEach(() => {
  clearServerData();
  jest.clearAllMocks();
  for (const method of Object.values(mockApi)) method.mockReset();
  mockApi.load.mockResolvedValue({ avatarId: null });
  mockApi.reserve.mockResolvedValue({ id, storagePath: `${id}.jpg`, current: false });
  mockApi.upload.mockResolvedValue(undefined);
  mockApi.finalize.mockResolvedValue({ avatarId: id });
  mockApi.remove.mockResolvedValue({ avatarId: null });
  mockApi.previews.mockResolvedValue({});
  mockPick.mockReset().mockResolvedValue(prepared);
  mockImageFetch.mockReset().mockResolvedValue({
    ok: true,
    headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: async () => new Uint8Array([255, 216, 255, 217]).buffer,
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(mockImageFetch);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.restoreAllMocks());
it('requires explicit saving after choosing an avatar and reuses the reservation on uncertain retry', async () => {
  const changed = jest.fn();
  mockApi.finalize.mockRejectedValueOnce(new Error('lost acknowledgement'));
  render(<AvatarEditor identity={identity} username="learner" onChanged={changed} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  await screen.findByRole('button', { name: 'Save photo' });
  expect(mockApi.reserve).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Save photo' }));
  await screen.findByRole('button', { name: 'Retry saving photo' });
  expect(changed).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  mockApi.reserve.mockResolvedValue({ id, storagePath: `${id}.jpg`, current: true });
  fireEvent.press(screen.getByRole('button', { name: 'Retry saving photo' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(mockApi.reserve.mock.calls[0][0]).toBe(mockApi.reserve.mock.calls[1][0]);
  expect(mockApi.upload).toHaveBeenCalledTimes(1);
  expect(mockApi.finalize).toHaveBeenCalledTimes(2);
  expect(feedback.success).toHaveBeenCalledTimes(1);
});
it('ignores a selected photo returned after an account switch', async () => {
  let finish: (value: typeof prepared) => void = () => {};
  mockPick.mockReturnValueOnce(
    new Promise<typeof prepared>((resolve) => {
      finish = resolve;
    }),
  );
  const changed = jest.fn();
  const view = render(<AvatarEditor identity={identity} username="learner" onChanged={changed} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  view.rerender(
    <AvatarEditor
      identity={{ userId: id, token: 'token-b' }}
      username="other"
      onChanged={changed}
    />,
  );
  await act(async () => finish(prepared));
  expect(screen.queryByRole('button', { name: 'Save photo' })).toBeNull();
  expect(mockApi.reserve).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
it('confirms avatar removal only once after the server accepts it', async () => {
  let finish = (_: { avatarId: null }) => {};
  mockApi.load.mockResolvedValueOnce({ avatarId: id });
  mockApi.remove.mockReturnValueOnce(
    new Promise<{ avatarId: null }>((resolve) => {
      finish = resolve;
    }),
  );
  const changed = jest.fn();
  render(<AvatarEditor identity={identity} username="learner" onChanged={changed} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Remove profile photo' }));
  expect(feedback.confirm).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
  fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
  expect(mockApi.remove).toHaveBeenCalledTimes(1);
  expect(feedback.confirm).not.toHaveBeenCalled();
  await act(async () => finish({ avatarId: null }));
  expect(feedback.confirm).toHaveBeenCalledTimes(1);
  expect(feedback.success).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(1);
});
it('reconciles an avatar that was saved before its acknowledgement was lost without replaying the write', async () => {
  mockApi.load.mockResolvedValueOnce({ avatarId: null }).mockResolvedValue({ avatarId: id });
  mockApi.finalize.mockRejectedValueOnce(new Error('lost acknowledgement'));
  render(<AvatarEditor identity={identity} username="learner" onChanged={jest.fn()} />);
  await waitFor(() => expect(mockApi.load).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Save photo' }));
  await screen.findByRole('button', { name: 'Retry saving photo' });
  await waitFor(() => expect(mockApi.load).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByRole('button', { name: 'Discard photo' }));
  await screen.findByRole('button', { name: 'Remove profile photo' });
  expect(mockApi.finalize).toHaveBeenCalledTimes(1);
  expect(mockApi.reserve).toHaveBeenCalledTimes(1);
});
it('reconciles a removed avatar after a lost acknowledgement and closes the obsolete confirmation', async () => {
  mockApi.load.mockResolvedValueOnce({ avatarId: id }).mockResolvedValue({ avatarId: null });
  mockApi.remove.mockRejectedValueOnce(new Error('lost acknowledgement'));
  render(<AvatarEditor identity={identity} username="learner" onChanged={jest.fn()} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Remove profile photo' }));
  fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
  await waitFor(() => expect(mockApi.load).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Remove profile photo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  expect(mockApi.remove).toHaveBeenCalledTimes(1);
});
it('rejects stale finalization responses after an account switch', async () => {
  let finish: (value: { avatarId: string }) => void = () => {};
  mockApi.finalize.mockReturnValueOnce(
    new Promise<{ avatarId: string }>((resolve) => {
      finish = resolve;
    }),
  );
  const changed = jest.fn();
  const view = render(<AvatarEditor identity={identity} username="learner" onChanged={changed} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Save photo' }));
  await waitFor(() => expect(mockApi.finalize).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockApi.finalize.mock.calls[0][1];
  const newAccountEntry = createServerCache<{ avatarId: string }>().entry(
    `${serverScope(id, 'token-b')}:public-profile`,
    ['avatars', 'public-profile'],
  );
  newAccountEntry.set({ avatarId: id });
  view.rerender(
    <AvatarEditor
      identity={{ userId: id, token: 'token-b' }}
      username="other"
      onChanged={changed}
    />,
  );
  await act(async () => finish({ avatarId: id }));
  expect(signal.aborted).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(newAccountEntry.getSnapshot().data).toEqual({ avatarId: id });
  expect(feedback.success).not.toHaveBeenCalled();
});
it('cancels an upload on background and never finalizes its late result', async () => {
  const listeners: ((state: 'active' | 'background') => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  let finish: () => void = () => {};
  mockApi.upload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<AvatarEditor identity={identity} username="learner" onChanged={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose profile photo' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Save photo' }));
  await waitFor(() => expect(mockApi.upload).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockApi.upload.mock.calls[0][2];
  act(() => listeners.forEach((listener) => listener('background')));
  await act(async () => finish());
  expect(signal.aborted).toBe(true);
  expect(mockApi.finalize).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Retry saving photo' })).not.toBeDisabled();
  expect(mockApi.load).toHaveBeenCalledTimes(1);
  act(() => listeners.forEach((listener) => listener('active')));
  await waitFor(() => expect(mockApi.load).toHaveBeenCalledTimes(2));
  expect(mockApi.finalize).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(feedback.success).not.toHaveBeenCalled();
});
it('keeps downloaded avatar pixels cached when returning to the same profile', async () => {
  const uri = `https://example.test/storage/v1/object/sign/profile-avatars/${id}.jpg?token=test`;
  mockApi.previews.mockResolvedValue({ [id]: uri });
  const view = render(<ProfileAvatar identity={identity} username="learner" avatarId={id} />);
  await waitFor(() =>
    expect(screen.getByLabelText("learner's profile photo")).toHaveProp('source', {
      uri: 'data:image/jpeg;base64,/9j/2Q==',
      cache: 'reload',
    }),
  );
  view.unmount();
  render(<ProfileAvatar identity={identity} username="learner" avatarId={id} />);
  await screen.findByLabelText("learner's profile photo");
  expect(mockApi.previews).toHaveBeenCalledTimes(1);
  expect(mockImageFetch).toHaveBeenCalledTimes(1);
});
it('never refetches an already downloaded avatar because its original signed access expires', async () => {
  jest.useFakeTimers();
  try {
    mockApi.previews.mockResolvedValue({ [id]: `https://example.test/${id}?token=old` });
    const view = render(<ProfileAvatar identity={identity} username="learner" avatarId={id} />);
    await waitFor(() =>
      expect(screen.getByLabelText("learner's profile photo")).toHaveProp('source', {
        uri: 'data:image/jpeg;base64,/9j/2Q==',
        cache: 'reload',
      }),
    );
    await act(async () => jest.advanceTimersByTime(600000));
    expect(mockApi.previews).toHaveBeenCalledTimes(1);
    expect(mockImageFetch).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<ProfileAvatar identity={identity} username="learner" avatarId={id} />);
    expect(screen.getByLabelText("learner's profile photo")).toHaveProp('source', {
      uri: 'data:image/jpeg;base64,/9j/2Q==',
      cache: 'reload',
    });
    expect(mockApi.previews).toHaveBeenCalledTimes(1);
    expect(mockImageFetch).toHaveBeenCalledTimes(1);
    // Revocation/long-background invalidation requires fresh authorization; it
    // cannot reuse either the discarded bitmap or its expired bearer URL.
    mockApi.previews.mockReturnValueOnce(new Promise(() => {}));
    act(() => invalidateServerData(['media'], { discard: true }));
    expect(screen.getByLabelText("learner's profile photo")).not.toHaveProp('source');
    await waitFor(() => expect(mockApi.previews).toHaveBeenCalledTimes(2));
    expect(mockImageFetch).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
it('discards replaced avatar pixels and never lets them cross a viewer account', async () => {
  mockApi.previews.mockResolvedValue({ [id]: `https://example.test/${id}?token=one` });
  const view = render(<ProfileAvatar identity={identity} username="learner" avatarId={id} />);
  await waitFor(() => expect(mockImageFetch).toHaveBeenCalledTimes(1));
  await act(async () => {});
  mockApi.previews.mockResolvedValue({});
  view.rerender(
    <ProfileAvatar
      identity={{ userId: id, token: 'other-session' }}
      username="other"
      avatarId={id}
    />,
  );
  await waitFor(() => expect(mockApi.previews).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("other's profile photo")).not.toHaveProp('source');
  expect(mockImageFetch).toHaveBeenCalledTimes(1);
});
it('rejects cross-account avatar payloads, arbitrary signed paths and duplicate IDs', () => {
  const base = 'https://example.test';
  const item = { id, signed_path: `/storage/v1/object/sign/profile-avatars/${id}.jpg?token=valid` };
  expect(parseAvatarState({ viewer_id: owner, avatar_id: id }, owner)).toEqual({ avatarId: id });
  expect(() => parseAvatarState({ viewer_id: id, avatar_id: id }, owner)).toThrow();
  expect(parseAvatarPreviews({ viewer_id: owner, items: [item] }, owner, [id], base)[id]).toBe(
    `${base}${item.signed_path}`,
  );
  for (const items of [
    [{ ...item, signed_path: 'https://attacker.example/photo' }],
    [item, item],
    [{ ...item, signed_path: `${item.signed_path}&download=1` }],
  ]) {
    expect(() => parseAvatarPreviews({ viewer_id: owner, items }, owner, [id], base)).toThrow();
  }
});
