import { privateFetch as fetch } from './transport';
import {
  timelineQuerySchema,
  timelineDataSchema,
  type TimelineQuery,
  type TimelineResult,
} from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';

export async function getTimeline(
  apiUrl: string,
  token: string | undefined,
  input: TimelineQuery,
  request = fetch,
): Promise<TimelineResult> {
  const query = timelineQuerySchema.parse(input);
  if (!storageConfigured(apiUrl, token))
    return { state: 'not_configured', data: null };
  try {
    const url = new URL('/timeline', apiUrl);
    url.search = new URLSearchParams(query).toString();
    const response = await request(url, {
      headers: { authorization: `Bearer ${token!}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403)
      return { state: 'unauthorized', data: null };
    if (!response.ok) return { state: 'unavailable', data: null };
    const data = timelineDataSchema.parse(await response.json());
    // Refuse a response for a different range/source; never cache private history.
    if (
      data.range.start !== query.start ||
      data.range.end !== query.end ||
      data.range.source !== query.source
    )
      return { state: 'unavailable', data: null };
    return { state: 'ready', data };
  } catch {
    return { state: 'unavailable', data: null };
  }
}
