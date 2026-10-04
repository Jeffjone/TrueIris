import {
  askRequestSchema,
  agentResultSchema,
  type AskRequest,
  type AgentResult,
} from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';

export class ReasoningClient {
  private active: AbortController | null = null;
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly request = fetch,
  ) {}
  cancel() {
    this.active?.abort();
  }
  async ask(input: AskRequest): Promise<AgentResult> {
    const query = askRequestSchema.parse(input);
    if (!storageConfigured(this.url, this.token))
      return { state: 'not_configured', data: null };
    if (this.active) return { state: 'busy', data: null };
    const controller = new AbortController();
    this.active = controller;
    try {
      const response = await this.request(new URL('/agent/ask', this.url), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token!}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(query),
        redirect: 'error',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(65_000),
        ]),
      });
      if (response.status === 401 || response.status === 403)
        return { state: 'unauthorized', data: null };
      if (!response.ok) return { state: 'unavailable', data: null };
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty reasoning response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 256 * 1024)
            throw new Error('Reasoning response too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = agentResultSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      if (controller.signal.aborted) return { state: 'cancelled', data: null };
      if (
        result.data &&
        (result.data.query.question !== query.question ||
          result.data.query.source !== query.source ||
          result.data.query.timezone !== query.timezone)
      )
        return { state: 'unavailable', data: null };
      return result;
    } catch {
      return {
        state: controller.signal.aborted ? 'cancelled' : 'unavailable',
        data: null,
      };
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
