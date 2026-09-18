import { schedulerHandler } from './handler.ts';
const counts = {
  attempted: 1,
  ticketAccepted: 1,
  rejected: 0,
  uncertain: 0,
  preparationFailures: 0,
  recordFailures: 0,
  receiptsChecked: 0,
  receiptFailures: 0,
};
const secret = 'a'.repeat(64);
Deno.test(
  'scheduler authenticates the job and never exposes tokens, recipients or provider payloads',
  async () => {
    let calls = 0;
    const handler = schedulerHandler(secret, () => {
      calls++;
      return Promise.resolve({ ...counts, token: 'private', words: ['private'] });
    });
    const request = (key = secret) =>
      new Request('https://local.test', {
        method: 'POST',
        headers: { 'x-notification-job-key': key },
      });
    if ((await handler(request('wrong'))).status !== 401 || calls !== 0)
      throw new Error('Missing auth gate');
    const response = await handler(request());
    if (JSON.stringify(await response.json()) !== JSON.stringify(counts))
      throw new Error('Unexpected projection');
  },
);
Deno.test(
  'scheduler failures are safe and missing configuration never calls the database',
  async () => {
    const request = new Request('https://local.test', {
      method: 'POST',
      headers: { 'x-notification-job-key': secret },
    });
    const missing = schedulerHandler(undefined, () => Promise.reject(new Error('must not run')));
    if ((await missing(request)).status !== 503) throw new Error('Missing config accepted');
    const disabled = schedulerHandler(
      secret,
      () => Promise.reject(new Error('must not consume attempts')),
      false,
    );
    if ((await disabled(request)).status !== 503)
      throw new Error('Missing provider config accepted');
    const failed = schedulerHandler(secret, () =>
      Promise.reject(new Error('sensitive database detail')),
    );
    const response = await failed(request);
    if (response.status !== 503 || (await response.text()).includes('sensitive'))
      throw new Error('Unsafe failure');
  },
);
