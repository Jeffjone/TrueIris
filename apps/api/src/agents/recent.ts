import {
  metricSchema,
  type BaselineContext,
  type TimelineData,
  type TimelineQuery,
} from '@trueiris/schemas';
import type { ToolName } from './tools';

export type Retrieval = {
  name: Exclude<ToolName, 'respond'>;
  args: Record<string, unknown>;
};
export function localDaypart(time: string, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(time)),
  );
  return (['night', 'morning', 'afternoon', 'evening'] as const)[
    Math.floor(hour / 6)
  ]!;
}
/** Only stored manual measurement labels select an activity baseline. Mixed/unlabelled history uses time of day. */
export function recentContext(
  range: TimelineQuery,
  timezone: string,
  data: TimelineData | null,
): BaselineContext {
  const labels = new Set(data?.activities.map((p) => p.activity));
  if (!data?.limited && labels.size === 1 && !labels.has(null))
    return { kind: 'activity', activity: [...labels][0]! };
  return { kind: 'time_of_day', period: localDaypart(range.start, timezone) };
}
export function recentRetrievals(
  range: TimelineQuery,
  timezone: string,
  data: TimelineData | null,
): Retrieval[] {
  const period = { start: range.start, end: range.end };
  const context = recentContext(range, timezone, data);
  return [
    { name: 'get_context', args: { range: period } },
    ...metricSchema.options.map((metric) => ({
      name: 'get_metrics' as const,
      args: { range: period, metric },
    })),
    ...metricSchema.options.map((metric) => ({
      name: 'compare_baseline' as const,
      args: { range: period, metric, context },
    })),
    {
      name: 'find_similar_sessions',
      args: {
        description:
          'Earlier sensing periods with the same recorded activity, when available',
        range: {
          start: new Date(
            Date.parse(range.start) - 30 * 86400_000,
          ).toISOString(),
          end: range.start,
        },
        activity: context.kind === 'activity' ? context.activity : null,
        limit: 3,
      },
    },
  ];
}
/** Compare declared argument values independently of object property order. */
export function sameRetrieval(a: Retrieval, b: Retrieval): boolean {
  function canonical(value: unknown): string {
    if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) &&
      Number.isFinite(Date.parse(value))
    )
      return JSON.stringify(new Date(value).toISOString());
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  // Description is a search hint only; it does not change the bounded SQL query.
  const withoutHint = (r: Retrieval) => {
    const { description: _hint, ...args } = r.args;
    void _hint;
    return args;
  };
  return (
    a.name === b.name && canonical(withoutHint(a)) === canonical(withoutHint(b))
  );
}
export function missingRecentRetrievals(
  plan: Retrieval[],
  completed: Retrieval[],
) {
  return plan.filter(
    (step) => !completed.some((done) => sameRetrieval(step, done)),
  );
}
