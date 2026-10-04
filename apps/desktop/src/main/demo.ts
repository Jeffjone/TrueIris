import { privateFetch as fetch } from './transport';
import { demoOutcomeSchema, type DemoOutcome } from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';
export class DemoClient {
  constructor(
    private readonly enabled: boolean,
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly request = fetch,
  ) {}
  async get(prepare = false): Promise<DemoOutcome> {
    if (!this.enabled) return { state: 'disabled', data: null };
    if (!storageConfigured(this.url, this.token))
      return { state: 'not_configured', data: null };
    try {
      const response = await this.request(
        new URL(prepare ? '/demo/prepare' : '/demo/history', this.url),
        {
          method: prepare ? 'POST' : 'GET',
          headers: {
            'x-trueiris-mode': 'demo',
            authorization: `Bearer ${this.token!}`,
            ...(prepare ? { 'content-type': 'application/json' } : {}),
          },
          ...(prepare ? { body: '{}' } : {}),
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (response.status === 401 || response.status === 403)
        return { state: 'unauthorized', data: null };
      if (!response.ok) return { state: 'unavailable', data: null };
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty demo response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 128 * 1024) throw new Error('Demo response limit');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const outcome = demoOutcomeSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (
        outcome.state === 'ready' &&
        Date.parse(outcome.data.generatedAt) > Date.now() + 1000
      )
        throw new Error('Future demo artifact');
      return outcome;
    } catch {
      return { state: 'unavailable', data: null };
    }
  }
}
