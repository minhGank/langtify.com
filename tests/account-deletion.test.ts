import { deleteAccount } from '@/services/account-deletion';
const mockRpc = jest.fn();
const mockSession = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockRpc }) }));
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://example.test', key: 'public' } },
}));
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ auth: { getSession: mockSession, signOut: mockSignOut } }),
}));
jest.mock('@/features/auth/oauth/runtime', () => ({
  authMutation: (work: () => Promise<unknown>) => work(),
}));
jest.mock('@/lib/auth-session-storage', () => ({
  authSessionId: (token: string) => token.split(':')[0],
}));
const session = (id = 'owner', token = 'session:token') => ({
  data: { session: { user: { id }, access_token: token } },
  error: null,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockSession.mockResolvedValue(session());
  mockSignOut.mockResolvedValue({ error: null });
});
it('deletes with no caller-selected identity and signs out only after success', async () => {
  await deleteAccount('session:token', 'owner');
  expect(mockRpc).toHaveBeenCalledWith('delete_my_account');
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('does not send a deletion for a changed account', async () => {
  mockSession.mockResolvedValue(session('another'));
  await expect(deleteAccount('session:token', 'owner')).rejects.toThrow('Account changed');
  expect(mockRpc).not.toHaveBeenCalled();
});
it('does not send a deletion for a changed session', async () => {
  mockSession.mockResolvedValue(session('owner', 'new-session:token'));
  await expect(deleteAccount('session:token', 'owner')).rejects.toThrow('Account changed');
  expect(mockRpc).not.toHaveBeenCalled();
});
it('never signs a new account out when an old deletion completes late', async () => {
  mockSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('another'));
  await deleteAccount('session:token', 'owner');
  expect(mockSignOut).not.toHaveBeenCalled();
});
it.each([
  { data: null, error: { message: 'provider secret' } },
  { data: false, error: null },
])('does not claim success on RPC failure', async (result) => {
  mockRpc.mockResolvedValue(result);
  await expect(deleteAccount('session:token', 'owner')).rejects.toThrow(
    'Deletion could not be confirmed',
  );
  expect(mockSignOut).not.toHaveBeenCalled();
});
it('allows an explicit retry after an uncertain response', async () => {
  mockRpc.mockRejectedValueOnce(new Error('network'));
  await expect(deleteAccount('session:token', 'owner')).rejects.toThrow();
  await deleteAccount('session:token', 'owner');
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
it('reports local sign-out failure without undoing deletion', async () => {
  mockSignOut.mockResolvedValue({ error: new Error('failed') });
  await expect(deleteAccount('session:token', 'owner')).rejects.toThrow('Local sign-out');
});
