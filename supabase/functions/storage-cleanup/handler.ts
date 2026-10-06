import type { cleanup } from './worker.ts';
export function handler(
  secret: string | undefined,
  run: (id: string) => ReturnType<typeof cleanup>,
  ready = true,
) {
  return async (request: Request) => {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!ready || !secret || !/^[0-9a-f]{64}$/.test(secret))
      return reply({ error: 'unconfigured' }, 503);
    if (request.headers.get('x-cleanup-job-key') !== secret)
      return reply({ error: 'unauthorized' }, 401);
    try {
      // Stream-bound the body; Content-Length is not trusted.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'invalid_request' }, 400);
      let text = '';
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > 256) {
          await reader.cancel();
          return reply({ error: 'invalid_request' }, 400);
        }
      }
      const input: unknown = JSON.parse(text);
      if (
        !input ||
        typeof input !== 'object' ||
        Object.keys(input).length !== 1 ||
        !('requestId' in input) ||
        typeof input.requestId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
      )
        return reply({ error: 'invalid_request' }, 400);
      const result = await run(input.requestId);
      return reply(result, result.status === 'retry' ? 503 : 200);
    } catch {
      return reply({ error: 'cleanup_failed' }, 503);
    }
  };
}
