import { z } from 'zod';
import {
  activitySchema,
  demoDatasetSchema,
  baselineDataSchema,
  baselineQuerySchema,
  timelineDataSchema,
  timelineQuerySchema,
  similarDataSchema,
  historyRangeSchema,
  evidenceSchema,
  metricSchema,
  respondSchema,
  type AskRequest,
  type AgentEvidence,
  type TimelineQuery,
  recentExplanationRange,
} from '@trueiris/schemas';
import type { MeasurementStore } from '@trueiris/db';
import { dayRange } from './time';
import { reconstructEvents } from './reconstruction';
import { recentContext } from './recent';
import { pulseTrajectory } from './trajectory';

const period = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .strict()
  .refine(
    (r) => timelineQuerySchema.safeParse({ ...r, source: 'live' }).success,
    'Select at most 26 hours',
  );
export const toolSchemas = {
  reconstruct_events: z.object({ range: period }).strict(),
  get_current_state: z.object({}).strict(),
  get_metrics: z.object({ range: period, metric: metricSchema }).strict(),
  get_context: z.object({ range: period }).strict(),
  compare_baseline: z
    .object({
      range: period,
      metric: metricSchema,
      context: baselineQuerySchema.shape.context,
    })
    .strict(),
  get_daily_summary: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .strict(),
  find_similar_sessions: z
    .object({
      description: z.string().trim().min(1).max(300),
      range: historyRangeSchema,
      activity: activitySchema.nullable(),
      limit: z.number().int().min(1).max(5),
    })
    .strict(),
  search_memories: z
    .object({
      query: z.string().trim().min(1).max(300),
      limit: z.number().int().min(1).max(5),
    })
    .strict(),
  respond: respondSchema,
};
export type ToolName = keyof typeof toolSchemas;
const descriptions: Record<ToolName, string> = {
  reconstruct_events:
    'Chronological first-party event reconstruction for a selected range: observed foreground apps, manual labels, switches, pulse epochs and baseline comparisons, gaps and uncertainty. Never infers task contents or causes.',
  get_current_state:
    'Current user-supplied local sensing/context status. Stale or different-source readings are withheld. No stored history.',
  get_metrics:
    'Exact quality-filtered mean/min/max/count plus lowest-value 30-second location and first/last accepted epoch means for a selected metric. Values describe physiology, not stress/focus.',
  get_context:
    'Bounded recorded application/activity/idle coverage. Missing, conflicting and limited context are explicit. Window titles are excluded.',
  compare_baseline:
    'Personal comparison for one metric and activity or local time of day. Historical interval excludes this period. Insufficient samples are explicit.',
  get_daily_summary:
    'Exact physiological summary and bounded context for a calendar date in the request timezone; DST-aware. Never infers focus/stress.',
  find_similar_sessions:
    'Recent activity-matched sensing periods in an earlier bounded historical range. Activity matching only; no semantic or causal/physiological similarity claim.',
  search_memories:
    'For demo_seed only, retrieves authored sample episode summaries by keyword. Real semantic embeddings remain unavailable; never fabricates remembered episodes.',
  respond:
    'Finish by choosing ordered factIds from retrieved evidence. All answer sentences come from these verified facts. Choose facts relevant to the question; include missing-data/limited evidence. Never invent factIds.',
};
export const toolDeclarations = Object.entries(toolSchemas).map(
  ([name, schema]) => ({
    name,
    description: descriptions[name as ToolName],
    parametersJsonSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }),
  }),
);
const metricInfo = {
  pulse: { label: 'Pulse', unit: 'bpm' },
  respiration: { label: 'Respiration', unit: 'breaths/min' },
  hrv: { label: 'HRV (RMSSD)', unit: 'ms' },
};
const safeName = (name: string) =>
  Array.from(name, (character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .slice(0, 80);
const number = (value: number) => value.toFixed(1);
export async function executeTool(
  name: Exclude<ToolName, 'respond'>,
  args: unknown,
  options: {
    store: Pick<
      MeasurementStore,
      'timeline' | 'baselines' | 'similarSessions' | 'demo'
    >;
    userId: string;
    request: AskRequest;
    asOf: string;
    id: string;
    signal: AbortSignal;
  },
): Promise<AgentEvidence> {
  const { store, userId, request, asOf, id, signal } = options;
  toolSchemas[name].parse(args);
  signal.throwIfAborted();
  const result: AgentEvidence = {
    id,
    tool: name,
    title: (
      {
        reconstruct_events: 'Recorded events',
        get_current_state: 'Current observations',
        get_metrics: 'Metric summary',
        get_context: 'Desktop context',
        compare_baseline: 'Personal baseline',
        get_daily_summary: 'Daily summary',
        find_similar_sessions: 'Historical activity matches',
        search_memories: 'Semantic memory',
      } as const
    )[name],
    range: null,
    status: 'ready',
    facts: [],
    limitations: [],
  };
  const fact = (
    text: string,
    value: number | null = null,
    range: TimelineQuery | null = result.range,
  ) =>
    result.facts.push({
      id: `${id}.f${result.facts.length + 1}`,
      text:
        range?.source === 'demo_seed'
          ? `In generated sample history, ${text.charAt(0).toLowerCase()}${text.slice(1)}`
          : text,
      value,
      range,
    });
  const caution = (text: string, value: number | null = null) => {
    fact(text, value);
    result.limitations.push(result.facts.at(-1)!.id);
  };
  const rangeFor = (range: { start: string; end: string }) => {
    if (Date.parse(range.end) > Date.parse(asOf) + 1000)
      throw new Error('Future history is unavailable');
    return timelineQuerySchema.parse({
      start: new Date(range.start).toISOString(),
      end: new Date(range.end).toISOString(),
      source: request.source,
    });
  };
  const timeline = async (range: TimelineQuery) => {
    signal.throwIfAborted();
    const data = timelineDataSchema.parse(await store.timeline(userId, range));
    if (JSON.stringify(data.range) !== JSON.stringify(range))
      throw new Error('Wrong history scope');
    signal.throwIfAborted();
    return data;
  };
  const metrics = (
    data: z.infer<typeof timelineDataSchema>,
    metric: z.infer<typeof metricSchema>,
  ) => {
    const info = metricInfo[metric],
      stats = data.summary[metric];
    if (stats.mean === null || stats.count === 0) {
      caution(
        `No accepted ${info.label.toLowerCase()} readings were saved in this period.`,
      );
      result.status = 'empty';
      return;
    }
    fact(
      `${info.label} averaged ${number(stats.mean)} ${info.unit} across ${stats.count} accepted readings; the recorded range was ${number(stats.min!)}–${number(stats.max!)} ${info.unit}.`,
      stats.mean,
    );
    fact(
      `${data.summary.observedSeconds} seconds contained saved observations in this ${number((Date.parse(data.range.end) - Date.parse(data.range.start)) / 1000)}-second period; unrecorded time is unknown.`,
      data.summary.observedSeconds,
    );
    const points = data.points
      .filter((p) => p[metric].mean !== null)
      .sort((a, b) => a.first.localeCompare(b.first));
    if (!data.limited && points.length) {
      const minimum = points.reduce((a, b) =>
        a[metric].min! <= b[metric].min! ? a : b,
      );
      fact(
        `The lowest accepted ${info.label.toLowerCase()} value was ${number(stats.min!)} ${info.unit}, within the 30-second interval ${minimum.start} to ${minimum.end}.`,
        stats.min,
        { ...data.range, start: minimum.start, end: minimum.end },
      );
      const first = points[0]!,
        last = points.at(-1)!;
      if (first.start !== last.start)
        fact(
          `The first recorded ${info.label.toLowerCase()} epoch averaged ${number(first[metric].mean!)} ${info.unit}; the last averaged ${number(last[metric].mean!)} ${info.unit}. Gaps and separate sessions are not a continuous trend.`,
          last[metric].mean,
        );
    }
    if (data.limited) {
      result.status = 'limited';
      caution(
        'Chart detail is limited. The exact period summary remains available; a full trend or extremum time cannot be established.',
      );
    }
  };
  const context = (data: z.infer<typeof timelineDataSchema>) => {
    const intervals = data.contexts ?? [];
    for (const label of new Set(
      data.activities.map((p) => p.activity).filter((a) => a !== null),
    ))
      fact(
        `Saved readings include manual ${label} activity labels in this period.`,
      );
    if (!intervals.length) {
      result.status = 'empty';
      caution(
        'No desktop context was saved in this period. Unrecorded application/activity time is unknown.',
      );
      return;
    }
    // Concurrent context sessions make duration attribution ambiguous: never add them twice.
    const ordered = [...intervals].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    let latestEnd = '';
    if (
      ordered.some((i) => {
        const overlap = i.start < latestEnd;
        latestEnd = latestEnd > i.end ? latestEnd : i.end;
        return overlap;
      })
    ) {
      caution(
        'Overlapping desktop context sessions make application duration ambiguous. No duration attribution is made.',
      );
      result.status = 'limited';
      return;
    }
    const apps = new Map<string, number>(),
      activities = new Map<string, number>();
    let observed = 0,
      idle = 0;
    for (const i of ordered) {
      const seconds = (Date.parse(i.end) - Date.parse(i.start)) / 1000;
      observed += seconds;
      if (i.idle) idle += seconds;
      if (i.application)
        apps.set(
          safeName(i.application.name),
          (apps.get(safeName(i.application.name)) ?? 0) + seconds,
        );
      const label =
        i.manualActivity ??
        (!i.idle && (i.classification?.confidence ?? 0) >= 0.8
          ? i.classification?.activity
          : undefined);
      if (label) activities.set(label, (activities.get(label) ?? 0) + seconds);
    }
    fact(
      `${number(observed)} seconds of desktop context were recorded; ${number(idle)} recorded seconds were idle.`,
      observed,
    );
    for (const [app, seconds] of [...apps]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3))
      fact(
        `You recorded ${number(seconds / 60)} minutes with ${JSON.stringify(app)} in the foreground during this period.`,
        seconds,
      );
    for (const [label, seconds] of [...activities]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3))
      fact(
        `Recorded ${label} activity covered ${number(seconds / 60)} minutes of this period (manual labels or confident estimates).`,
        seconds,
      );
    if (data.limited) {
      result.status = 'limited';
      caution(
        'Desktop detail reached its display limit; these durations describe only returned intervals, not the whole period.',
      );
    }
  };
  switch (name) {
    case 'reconstruct_events': {
      const range = rangeFor(toolSchemas.reconstruct_events.parse(args).range);
      const data = await timeline(range);
      if (
        data.contexts?.some(
          (c) =>
            c.source !== range.source ||
            c.start < range.start ||
            c.end > range.end,
        )
      )
        throw new Error('Wrong context scope');
      const query = baselineQuerySchema.parse({
        range,
        context: recentContext(range, request.timezone, data),
        timezone: request.timezone,
        lookbackDays: 30,
      });
      let baseline: z.infer<typeof baselineDataSchema> | null = null;
      try {
        baseline = baselineDataSchema.parse(
          await store.baselines(userId, query),
        );
        if (JSON.stringify(baseline.query) !== JSON.stringify(query))
          throw new Error('Wrong baseline scope');
      } catch {
        baseline = null;
      }
      signal.throwIfAborted();
      return evidenceSchema.parse(reconstructEvents(data, baseline, id));
    }

    case 'get_current_state': {
      const c = request.current;
      fact(
        `Local camera sensing is ${c.sensor}; desktop context is ${c.context}; saving is ${c.saving ? 'on' : 'off'}. These are current client-reported states, not historical evidence.`,
      );
      const reading = c.reading;
      if (
        reading &&
        reading.source === request.source &&
        Date.parse(asOf) - Date.parse(reading.timestamp) >= -1000 &&
        Date.parse(asOf) - Date.parse(reading.timestamp) <= 15_000 &&
        ['good', 'excellent'].includes(reading.signalQuality) &&
        !reading.talking
      ) {
        for (const [key, value, confidence, threshold] of [
          ['pulse', reading.pulseRate, reading.pulseConfidence, 0.4],
          [
            'respiration',
            reading.respirationRate,
            reading.respirationConfidence,
            0.45,
          ],
          ['hrv', reading.hrvRmssd, reading.hrvConfidence, 0.5],
        ] as const)
          if (value !== undefined && (confidence ?? 0) >= threshold)
            fact(
              `The current local ${metricInfo[key].label.toLowerCase()} reading is ${number(value)} ${metricInfo[key].unit}, observed at ${reading.timestamp}.`,
              value,
            );
      } else
        fact(
          'There is no fresh accepted local reading for the selected source.',
        );
      if (
        c.context === 'running' &&
        c.contextSource === request.source &&
        c.application
      )
        fact(
          `The client currently reports ${JSON.stringify(safeName(c.application))} in the foreground.`,
        );
      break;
    }
    case 'get_metrics': {
      const input = toolSchemas.get_metrics.parse(args);
      result.range = rangeFor(input.range);
      metrics(await timeline(result.range), input.metric);
      break;
    }
    case 'get_context': {
      const input = toolSchemas.get_context.parse(args);
      result.range = rangeFor(input.range);
      const data = await timeline(result.range);
      context(data);
      if (!data.contexts?.length) result.status = 'empty';
      break;
    }
    case 'get_daily_summary': {
      const input = toolSchemas.get_daily_summary.parse(args),
        bounds = dayRange(input.date, request.timezone);
      const end = new Date(
        Math.min(Date.parse(bounds.end), Date.parse(asOf)),
      ).toISOString();
      result.range = rangeFor({ ...bounds, end });
      const data = await timeline(result.range);
      for (const metric of metricSchema.options) metrics(data, metric);
      context(data);
      break;
    }
    case 'compare_baseline': {
      const input = toolSchemas.compare_baseline.parse(args);
      result.range = rangeFor(input.range);
      const query = baselineQuerySchema.parse({
        range: result.range,
        context: input.context,
        timezone: request.timezone,
        lookbackDays: 30,
      });
      const data = baselineDataSchema.parse(
        await store.baselines(userId, query),
      );
      if (JSON.stringify(data.query) !== JSON.stringify(query))
        throw new Error('Wrong baseline scope');
      const c = data.comparisons.find((c) => c.metric === input.metric)!,
        info = metricInfo[input.metric];
      const label =
        input.context.kind === 'activity'
          ? input.context.activity
          : input.context.period;
      if (c.state === 'insufficient_history') {
        result.status = 'empty';
        caution(
          `There is insufficient ${label} history for a personal ${info.label.toLowerCase()} baseline: ${c.sampleCount} qualifying samples across ${c.dayCount} local dates; at least 20 samples across 3 dates are required.`,
          c.sampleCount,
        );
      } else {
        fact(
          `Your earlier ${label} ${info.label.toLowerCase()} baseline was ${number(c.baseline!)} ${info.unit}, from ${c.sampleCount} qualifying samples across ${c.dayCount} local dates in the preceding 30 days. Evidence confidence is ${number(c.confidence * 100)}%, a support heuristic rather than a health probability.`,
          c.baseline,
        );
        if (c.state === 'no_current_data') {
          result.status = 'empty';
          caution(
            `No accepted ${info.label.toLowerCase()} readings matched ${label} in the selected period.`,
          );
        } else
          fact(
            `In this period, ${label} ${info.label.toLowerCase()} averaged ${number(c.current!)} ${info.unit}, ${number(Math.abs(c.differenceAbsolute!))} ${info.unit} ${c.differenceAbsolute! >= 0 ? 'above' : 'below'} your earlier baseline${c.differencePercent === null ? ' (percentage unavailable for a zero baseline)' : ` (${number(Math.abs(c.differencePercent))}% ${c.differencePercent >= 0 ? 'above' : 'below'})`}.`,
            c.current,
          );
      }
      if (input.metric === 'pulse' && recentExplanationRange(request, asOf)) {
        const data = await timeline(result.range);
        for (const observation of pulseTrajectory(
          data,
          c,
          input.context,
          request.timezone,
        ))
          fact(observation.text, observation.value, observation.range);
      }
      break;
    }
    case 'find_similar_sessions': {
      const input = toolSchemas.find_similar_sessions.parse(args);
      if (Date.parse(input.range.end) > Date.parse(asOf))
        throw new Error('Future history unavailable');
      const query = {
        range: input.range,
        source: request.source,
        activity: input.activity,
        limit: input.limit,
      };
      const data = similarDataSchema.parse(
        await store.similarSessions(userId, query),
      );
      if (JSON.stringify(data.query) !== JSON.stringify(query))
        throw new Error('Wrong session scope');
      fact(
        'Historical matches use recorded activity labels and recency only. They do not establish semantic or physiological similarity.',
      );
      if (!data.sessions.length) {
        result.status = 'empty';
        caution(
          'No historical activity-matched sensing periods were found in this range.',
        );
      }
      for (const session of data.sessions) {
        if (
          session.range.source !== request.source ||
          Date.parse(session.range.start) < Date.parse(input.range.start) ||
          Date.parse(session.range.end) > Date.parse(input.range.end)
        )
          throw new Error('Wrong historical scope');
        fact(
          `A recent ${input.activity ?? 'unfiltered'} sensing period from ${session.range.start} to ${session.range.end} contained ${session.count} saved observations.`,
          session.count,
          session.range,
        );
        for (const metric of metricSchema.options)
          if (session[metric] !== null)
            fact(
              `That historical period's accepted ${metricInfo[metric].label.toLowerCase()} averaged ${number(session[metric]!)} ${metricInfo[metric].unit}.`,
              session[metric],
              session.range,
            );
      }
      break;
    }
    case 'search_memories': {
      if (request.source === 'demo_seed' && store.demo) {
        const input = toolSchemas.search_memories.parse(args);
        const raw = await store.demo.get(userId);
        const data = raw ? demoDatasetSchema.parse(raw) : null;
        if (data) {
          result.title = 'Seeded episode summaries';
          caution(
            'These are authored sample summaries from generated demo_seed history. Retrieval matches words only; semantic embeddings and real episodic memory are not implemented.',
          );
          const words = input.query.toLowerCase().match(/[a-z]{3,}/g) ?? [];
          const matches = data.episodes
            .filter((e) => Date.parse(e.range.end) <= Date.parse(asOf))
            .map((e) => ({
              episode: e,
              score: words.filter((word) =>
                (e.title + ' ' + e.tags.join(' ')).toLowerCase().includes(word),
              ).length,
            }))
            .filter((e) => e.score > 0)
            .sort(
              (a, b) =>
                b.score - a.score ||
                b.episode.range.start.localeCompare(a.episode.range.start),
            )
            .slice(0, input.limit);
          for (const { episode } of matches)
            fact(episode.summary, episode.pulse, episode.range);
          if (!matches.length) {
            result.status = 'empty';
            caution('No sample episode summary matched these words.');
          }
          break;
        }
      }
      result.status = 'unavailable';
      caution(
        'Semantic episodic memory is not available yet. No remembered episodes or semantic matches can be claimed.',
      );
      break;
    }
  }
  signal.throwIfAborted();
  const validated = evidenceSchema.parse(result);
  if (JSON.stringify(validated).length > 16_000)
    throw new Error('Evidence too large');
  return validated;
}
