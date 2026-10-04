import { contextBatchSchema, type ContextInterval } from '@trueiris/schemas';
import { RecordQueue } from '../storage/queue';
export function createContextQueue(
  apiUrl: string,
  token: string | undefined,
  configured: boolean,
) {
  return new RecordQueue<ContextInterval>(
    configured,
    async (intervals) => {
      const response = await fetch(new URL('/context/batch', apiUrl), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${token ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(contextBatchSchema.parse({ intervals })),
      });
      return {
        status: response.status,
        ...(response.ok ? { body: (await response.json()) as unknown } : {}),
      };
    },
    Date.now,
    Math.random,
    120,
    30,
  );
}
