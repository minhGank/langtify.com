import { expoTransport } from './expo.ts';
import { runNotificationJob, type Attempt, type NotificationStore } from './worker.ts';
const id = '81000000-0000-4000-8000-000000000001';
const attempt: Attempt = {
  id,
  userId: id,
  token: 'ExpoPushToken[fixture]',
  type: 'DAILY_WORDS',
  title: "Today's 3 words are ready",
  body: 'chien · fenêtre · bondé',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
Deno.test('HTTP rejection releases the response body without resending', async () => {
  let cancelled = false,
    calls = 0;
  const provider = expoTransport('test', () => {
    calls++;
    return Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 429 },
      ),
    );
  });
  const result = await provider.send([attempt]);
  assert(result[0].error === 'HTTP_429' && calls === 1 && cancelled);
});
Deno.test(
  'sender uses one fixed HTTPS call with authoritative words, recipient, expiry and fixed Today data',
  async () => {
    let calls = 0;
    const provider = expoTransport('test-access', (url, init) => {
      calls++;
      assert(url === 'https://exp.host/--/api/v2/push/send');
      assert(
        init?.redirect === 'error' &&
          new Headers(init.headers).get('Authorization') === 'Bearer test-access',
      );
      const body = JSON.parse(String(init.body));
      assert(body.length === 1 && body[0].body === attempt.body && body[0].to === attempt.token);
      assert(
        body[0].expiration === attempt.expiresAt &&
          body[0].data.type === 'DAILY_WORDS' &&
          !body[0].data.route,
      );
      return Promise.resolve(Response.json({ data: [{ status: 'ok', id }] }));
    });
    const result = await provider.send([attempt]);
    assert(calls === 1 && result[0].state === 'ticket_accepted' && result[0].ticketId === id);
  },
);
Deno.test(
  'timeout settles even if transport ignores abort and never automatically resends',
  async () => {
    let calls = 0;
    const provider = expoTransport(
      'test-access',
      () => {
        calls++;
        return new Promise(() => {});
      },
      1,
    );
    let failed = false;
    try {
      await provider.send([attempt]);
    } catch {
      failed = true;
    }
    assert(failed && calls === 1);
  },
);
Deno.test(
  '429, server failure, malformed success and invalid token each consume only one call and retain safe results',
  async () => {
    for (const response of [
      new Response('', { status: 429 }),
      new Response('', { status: 503 }),
      Response.json({ data: [] }),
      Response.json({
        data: [
          { status: 'error', message: attempt.token, details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    ]) {
      let calls = 0;
      const result = await expoTransport('test', () => {
        calls++;
        return Promise.resolve(response);
      }).send([attempt]);
      assert(calls === 1 && result[0].state !== 'ticket_accepted');
      assert(!JSON.stringify(result).includes(attempt.token));
    }
  },
);
Deno.test(
  'expired attempts never reach provider and unknown errors cannot leak raw messages',
  async () => {
    let calls = 0;
    const provider = expoTransport('test', () => {
      calls++;
      return Promise.resolve(
        Response.json({
          data: [{ status: 'error', message: 'private', details: { error: 'private' } }],
        }),
      );
    });
    const expired = await provider.send([{ ...attempt, expiresAt: 1 }]);
    assert(calls === 0 && expired[0].error === 'WindowExpired');
    const result = await provider.send([attempt]);
    assert(result[0].error === 'ProviderError' && !JSON.stringify(result).includes('private'));
  },
);
Deno.test(
  'receipt lookup maps requested tickets only and does not interpret provider acceptance as device delivery',
  async () => {
    const provider = expoTransport('test', (url) => {
      assert(url === 'https://exp.host/--/api/v2/push/getReceipts');
      return Promise.resolve(
        Response.json({
          data: {
            [id]: { status: 'error', details: { error: 'DeviceNotRegistered' } },
            foreign: { status: 'ok' },
          },
        }),
      );
    });
    const result = await provider.receipts([id, 'missing']);
    assert(result.size === 1 && result.get(id)?.error === 'DeviceNotRegistered');
  },
);
Deno.test('recording failure and later jobs never resend an already consumed attempt', async () => {
  let claimed = false,
    sends = 0;
  const store: NotificationStore = {
    claim: () => {
      const attempts = claimed ? [] : [attempt];
      claimed = true;
      return Promise.resolve({ attempts, failed: 0 });
    },
    authorize: () => Promise.resolve(true),
    result: () => Promise.reject(new Error('Database response lost')),
    receipts: () => Promise.resolve([]),
    receipt: () => Promise.resolve(),
  };
  const provider = {
    send: () => {
      sends++;
      return Promise.resolve([{ state: 'ticket_accepted' as const, ticketId: id }]);
    },
    receipts: () => Promise.resolve(new Map()),
  };
  const first = await runNotificationJob(store, provider);
  await runNotificationJob(store, provider);
  assert(sends === 1 && first.recordFailures === 1);
});
Deno.test(
  'one bad recipient does not prevent other admitted recipients from being attempted',
  async () => {
    const records: string[] = [];
    const store: NotificationStore = {
      claim: () => Promise.resolve({ attempts: [attempt, { ...attempt, id: 'other' }], failed: 0 }),
      authorize: () => Promise.resolve(true),
      result: (id) => {
        records.push(id);
        return Promise.resolve();
      },
      receipts: () => Promise.resolve([]),
      receipt: () => Promise.resolve(),
    };
    const result = await runNotificationJob(store, {
      send: (values) =>
        values[0].id === id
          ? Promise.reject(new Error('network'))
          : Promise.resolve([{ state: 'ticket_accepted', ticketId: id }]),
      receipts: () => Promise.resolve(new Map()),
    });
    assert(result.uncertain === 1 && result.ticketAccepted === 1 && records.length === 2);
  },
);

Deno.test(
  'failed final eligibility never sends and records only a consumed rejected attempt',
  async () => {
    let sends = 0,
      rejected = false;
    const store: NotificationStore = {
      claim: () => Promise.resolve({ attempts: [attempt], failed: 0 }),
      authorize: () => Promise.resolve(false),
      result: (_id, ticket) => {
        rejected = ticket.error === 'EligibilityChanged';
        return Promise.resolve();
      },
      receipts: () => Promise.resolve([]),
      receipt: () => Promise.resolve(),
    };
    await runNotificationJob(store, {
      send: () => {
        sends++;
        return Promise.resolve([]);
      },
      receipts: () => Promise.resolve(new Map()),
    });
    assert(sends === 0 && rejected);
  },
);
