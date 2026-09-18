export function schedulerHandler(
  secret: string | undefined,
  prepare: () => Promise<unknown>,
  ready = true,
) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!ready || !secret || !/^[0-9a-f]{64}$/.test(secret))
      return reply({ error: 'scheduler_unconfigured' }, 503);
    if (request.headers.get('x-notification-job-key') !== secret)
      return reply({ error: 'unauthorized' }, 401);
    try {
      const result = await prepare();
      // Explicit count projection: no tokens, recipients, words or provider bodies.
      const fields = [
        'attempted',
        'ticketAccepted',
        'rejected',
        'uncertain',
        'preparationFailures',
        'recordFailures',
        'receiptsChecked',
        'receiptFailures',
      ];
      if (!result || typeof result !== 'object') throw new Error('Invalid result');
      const counts: Record<string, number> = {};
      for (const field of fields) {
        const value: unknown = Reflect.get(result, field);
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
          throw new Error('Invalid result');
        counts[field] = value;
      }
      return reply(counts);
    } catch {
      return reply({ error: 'notification_job_failed' }, 503);
    }
  };
}
