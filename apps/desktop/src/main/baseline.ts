import { privateFetch as fetch } from './transport';
import {
  baselineQuerySchema,
  baselineDataSchema,
  type BaselineQuery,
  type BaselineResult,
} from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';
export async function getBaselines(
  apiUrl: string,
  token: string | undefined,
  input: BaselineQuery,
  request = fetch,
): Promise<BaselineResult> {
  const query = baselineQuerySchema.parse(input);
  if (!storageConfigured(apiUrl, token))
    return { state: 'not_configured', data: null };
  try {
    const response = await request(new URL('/baselines/compare', apiUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token!}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(query),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403)
      return { state: 'unauthorized', data: null };
    if (!response.ok) return { state: 'unavailable', data: null };
    const data = baselineDataSchema.parse(await response.json());
    if (
      JSON.stringify(data.query) !== JSON.stringify(query) ||
      data.historyEnd !== query.range.start ||
      data.historyStart !==
        new Date(
          Date.parse(query.range.start) - query.lookbackDays * 86400_000,
        ).toISOString()
    )
      return { state: 'unavailable', data: null };
    return { state: 'ready', data };
  } catch {
    return { state: 'unavailable', data: null };
  }
}
