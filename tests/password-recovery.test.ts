import { RecoveryController } from '@/features/auth/recovery/controller';
const id = '00000000-0000-4000-8000-000000000001';
const link = 'langtify://auth/callback?code=valid-code-123';
function fixture() {
  let saved: string | null = null;
  let current = true;
  const client = {
    request: jest.fn().mockResolvedValue(undefined),
    exchange: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const signedIn = jest.fn().mockResolvedValue(false);
  const ports = {
    read: async () => saved,
    write: async (value: string) => {
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
    client: () => client,
    current: () => current,
    signedIn,
    now: () => 1000,
  };
  return {
    controller: new RecoveryController(ports),
    ports,
    client,
    signedIn,
    supersede: () => {
      current = false;
    },
  };
}
it('requests recovery neutrally, exchanges once, updates only the staged session and requires sign-in afterward', async () => {
  const { controller, client } = fixture();
  await controller.request(' person@example.test ', id);
  expect(client.request).toHaveBeenCalledWith('person@example.test');
  expect(controller.snapshot().message).toMatch(/^If an account/);
  await Promise.all([controller.receive(link), controller.receive(link)]);
  expect(client.exchange).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().phase).toBe('ready');
  await controller.receive(link);
  expect(client.exchange).toHaveBeenCalledTimes(1);
  const phases: string[] = [];
  controller.subscribe(() => phases.push(controller.snapshot().phase));
  await Promise.all([controller.update('new-password'), controller.update('other-password')]);
  expect(phases).not.toContain('idle');
  expect(client.update).toHaveBeenCalledTimes(1);
  expect(client.update).toHaveBeenCalledWith('new-password');
  expect(controller.snapshot().phase).toBe('success');
  expect(client.clear).toHaveBeenCalled();
});
it('rejects invalid email before contacting Auth', async () => {
  const { controller, client } = fixture();
  await expect(controller.request('invalid', id)).rejects.toThrow('valid email');
  expect(client.request).not.toHaveBeenCalled();
});
it('restores a pending request after restart without restoring a recovery session', async () => {
  const { controller, ports, client } = fixture();
  await controller.request('person@example.test', id);
  const restarted = new RecoveryController(ports);
  await restarted.receive(link);
  expect(restarted.snapshot().phase).toBe('ready');
  const interrupted = new RecoveryController(ports);
  await interrupted.receive(link);
  expect(interrupted.snapshot().phase).toBe('error');
  expect(client.exchange).toHaveBeenCalledTimes(1);
});
it.each([
  'langtify://auth/callback#access_token=token&refresh_token=secret',
  'langtify://auth/callback?code=one-code&code=other-code',
  'langtify://auth/callback?error=access_denied&error_code=otp_expired',
  'https://evil.test/auth/callback?code=valid-code-123',
])('rejects invalid callback without consuming URL sessions: %s', async (url) => {
  const { controller, client } = fixture();
  await controller.request('person@example.test', id);
  await controller.receive(url);
  expect(controller.snapshot().phase).toBe('error');
  expect(client.exchange).not.toHaveBeenCalled();
});
it('leaves a callback without a recovery request for the existing Google flow', async () => {
  const { controller } = fixture();
  expect(await controller.receive(link)).toBe(false);
});
it('rejects old links and already signed-in accounts', async () => {
  for (const expired of [true, false]) {
    const { controller, ports, client, signedIn } = fixture();
    await controller.request('person@example.test', id);
    if (expired) ports.now = () => 3601001;
    else signedIn.mockResolvedValue(true);
    await controller.receive(link);
    expect(client.exchange).not.toHaveBeenCalled();
    expect(controller.snapshot().phase).toBe('error');
  }
});
it('cancellation fences a late successful exchange', async () => {
  const { controller, client } = fixture();
  let resolve!: () => void;
  client.exchange.mockImplementation(
    () =>
      new Promise<void>((yes) => {
        resolve = yes;
      }),
  );
  await controller.request('person@example.test', id);
  const work = controller.receive(link);
  while (!client.exchange.mock.calls.length) await Promise.resolve();
  await controller.cancel();
  resolve();
  await work;
  expect(controller.snapshot().phase).toBe('idle');
  await controller.update('new-password');
  expect(client.update).not.toHaveBeenCalled();
});
it('preserves policy, allows explicit weak-password correction and never retries uncertain updates', async () => {
  const { controller, client } = fixture();
  await controller.request('person@example.test', id);
  await controller.receive(link);
  await controller.update('short');
  expect(client.update).not.toHaveBeenCalled();
  client.update.mockRejectedValueOnce({ code: 'weak_password' });
  await controller.update('new-password');
  expect(controller.snapshot().phase).toBe('ready');
  client.update.mockRejectedValueOnce(new Error('private provider details'));
  await controller.update('new-password');
  expect(controller.snapshot().phase).toBe('failed');
  expect(controller.snapshot().message).not.toContain('private provider');
  await controller.update('new-password');
  expect(client.update).toHaveBeenCalledTimes(2);
});
it('a newer browser intent cannot update the recovery password', async () => {
  const { controller, client, supersede } = fixture();
  await controller.request('person@example.test', id);
  await controller.receive(link);
  supersede();
  await controller.update('new-password');
  expect(client.update).not.toHaveBeenCalled();
});
it('obscures account-not-found reset responses', async () => {
  const { controller, client } = fixture();
  client.request.mockRejectedValue({ code: 'user_not_found', message: 'private provider detail' });
  await controller.request('person@example.test', id);
  expect(controller.snapshot().phase).toBe('sent');
  expect(controller.snapshot().message).toMatch(/^If an account/);
});
it('disposes the isolated session and provides recovery guidance if local cleanup fails', async () => {
  const { controller, client, ports } = fixture();
  await controller.request('person@example.test', id);
  await controller.receive(link);
  ports.remove = async () => {
    throw new Error('Storage unavailable');
  };
  await controller.update('new-password');
  expect(client.clear).toHaveBeenCalled();
  expect(controller.snapshot().phase).toBe('failed');
  await controller.update('other-password');
  expect(client.update).toHaveBeenCalledTimes(1);
});
