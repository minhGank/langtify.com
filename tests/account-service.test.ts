import { completeOnboarding } from '@/services/account';

const mockHeader = jest.fn();
const mockRpc = jest.fn(() => ({ setHeader: mockHeader }));
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: mockRpc }) }));
beforeEach(() => {
  jest.clearAllMocks();
  mockHeader.mockResolvedValue({ error: null });
});
it('binds the onboarding RPC to the captured session instead of a later shared-client session', async () => {
  await completeOnboarding(
    {
      username: ' Learner ',
      referenceLanguageId: 'en',
      targetLanguageId: 'fr',
      cefrLevel: 'B1',
      timezone: 'UTC',
    },
    'captured-session-token',
  );
  expect(mockRpc).toHaveBeenCalledWith(
    'complete_onboarding',
    expect.objectContaining({ p_username: 'learner' }),
  );
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer captured-session-token');
});
it('propagates a rejected transaction to the form instead of treating it as success', async () => {
  const failure = { code: '23505' };
  mockHeader.mockResolvedValue({ error: failure });
  await expect(
    completeOnboarding(
      {
        username: 'learner',
        referenceLanguageId: 'en',
        targetLanguageId: 'fr',
        cefrLevel: 'B1',
        timezone: 'UTC',
      },
      'captured-session-token',
    ),
  ).rejects.toEqual(failure);
});
