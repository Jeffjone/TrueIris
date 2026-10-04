import { useEffect, useState } from 'react';
import type { TimelineQuery, TimelineResult } from '@trueiris/schemas';
export function useTimeline(query: TimelineQuery | null, revision = 0) {
  const [response, setResponse] = useState<{
    query: TimelineQuery;
    result: TimelineResult;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const start = query?.start,
    end = query?.end,
    source = query?.source;
  useEffect(() => {
    let active = true,
      inFlight = false;
    if (!start || !end || !source) return;
    const request = { start, end, source };
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      setBusy(true);
      let result: TimelineResult;
      try {
        result = (await window.trueiris?.getTimeline(request)) ?? {
          state: 'not_configured',
          data: null,
        };
      } catch {
        result = { state: 'unavailable', data: null };
      }
      if (active) {
        setResponse({ query: request, result });
        setBusy(false);
      }
      inFlight = false;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [start, end, source, revision]);
  // Keep the chart stable while Today extends. A different source, day or zoom
  // never displays old data, and a failed refresh discards previously shown data.
  const matches =
    response &&
    response.query.start === start &&
    response.query.source === source &&
    (response.query.end === end ||
      (response.result.state === 'ready' &&
        end &&
        Date.parse(response.query.end) < Date.parse(end)));
  return {
    result: query && matches ? response.result : null,
    loading: Boolean(query && (busy || !matches)),
  };
}
