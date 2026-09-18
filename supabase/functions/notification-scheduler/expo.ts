import type { Attempt, PushTransport, Receipt, Ticket } from './worker.ts';
const root = 'https://exp.host/--/api/v2/push';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const errors = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
  'UNAUTHORIZED',
]);
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function errorCode(value: unknown): string {
  const code = record(record(value).details).error;
  return typeof code === 'string' && errors.has(code) ? code : 'ProviderError';
}

// Endpoint is fixed, not caller/env-controlled. Tests inject a transport, never
// production URLs or credentials. Deliberately do not use an SDK that retries sends.
export function expoTransport(
  accessToken: string,
  fetcher: typeof fetch = fetch,
  timeout = 10000,
): PushTransport {
  async function post(path: 'send' | 'getReceipts', body: unknown) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Provider timeout'));
      }, timeout);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(`${root}/${path}`, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            await response.body?.cancel();
            return { status: response.status, body: null };
          }
          // Bound provider input; never store/log free-form errors containing tokens.
          const reader = response.body?.getReader();
          if (!reader) return { status: 200, body: null };
          let size = 0,
            source = '';
          const decoder = new TextDecoder();
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 262144) {
                await reader.cancel();
                throw new Error('Provider response too large');
              }
              source += decoder.decode(chunk.value, { stream: true });
            }
            source += decoder.decode();
          } finally {
            reader.releaseLock();
          }
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(source);
          } catch {
            /* Unknown outcome, never resend. */
          }
          return { status: 200, body: parsed };
        })(),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async send(attempts: Attempt[]): Promise<Ticket[]> {
      if (!attempts.length || attempts.length > 100) throw new Error('Invalid batch');
      // Database date/expiry is authoritative. Drop expired work, never carry it
      // into another date. No notification content or recipient comes from a client.
      const live = attempts.filter((a) => a.expiresAt > Math.floor(Date.now() / 1000));
      const results = new Map<string, Ticket>();
      for (const a of attempts)
        if (!live.includes(a))
          results.set(a.id, { state: 'send_rejected', error: 'WindowExpired' });
      if (live.length) {
        const response = await post(
          'send',
          live.map((a) => ({
            to: a.token,
            title: a.title,
            body: a.body,
            sound: 'default',
            channelId: 'learning',
            expiration: a.expiresAt,
            data: { type: a.type, userId: a.userId },
          })),
        );
        const data = record(response.body).data;
        const aligned = Array.isArray(data) && data.length === live.length;
        live.forEach((a, i) => {
          const row = aligned ? record(data[i]) : {};
          let ticket: Ticket = { state: 'uncertain', error: 'MalformedResponse' };
          if (response.status !== 200)
            ticket = {
              state: response.status >= 500 ? 'uncertain' : 'send_rejected',
              error: `HTTP_${response.status}`,
            };
          else if (row.status === 'ok' && typeof row.id === 'string' && uuid.test(row.id))
            ticket = { state: 'ticket_accepted', ticketId: row.id };
          else if (row.status === 'error')
            ticket = { state: 'send_rejected', error: errorCode(row) };
          results.set(a.id, ticket);
        });
      }
      return attempts.map(
        (a) => results.get(a.id) ?? { state: 'uncertain', error: 'MalformedResponse' },
      );
    },
    async receipts(ids): Promise<Map<string, Receipt>> {
      if (!ids.length || ids.length > 100) throw new Error('Invalid receipt batch');
      const response = await post('getReceipts', { ids });
      if (response.status !== 200 || !record(response.body).data)
        throw new Error('Receipt unavailable');
      const data = record(record(response.body).data),
        results = new Map<string, Receipt>();
      for (const id of ids) {
        const row = record(data[id]);
        if (row.status === 'ok') results.set(id, { status: 'ok' });
        else if (row.status === 'error')
          results.set(id, { status: 'error', error: errorCode(row) });
      }
      return results;
    },
  };
}
