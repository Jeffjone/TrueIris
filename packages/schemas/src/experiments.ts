import { z } from 'zod';
import { dataSourceSchema } from './reading';
import { activitySchema } from './activity';
import { baselineQuerySchema, baselineComparisonSchema } from './baseline';
import { timelineQuerySchema } from './timeline';
export const experimentMetricSchema = z.enum([
  'session_duration',
  'focus_rating',
  'pulse_deviation',
  'hrv_deviation',
]);
export const experimentStatusSchema = z.enum(['active', 'paused', 'completed']);
export const experimentDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    hypothesis: z.string().trim().min(1).max(500),
    conditions: z.tuple([
      z.string().trim().min(1).max(60),
      z.string().trim().min(1).max(60),
    ]),
    criteria: z
      .array(
        z
          .object({
            metric: experimentMetricSchema,
            meaningfulDifference: z.number().finite().positive().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    minimumSessions: z.number().int().min(6).max(200),
    source: dataSourceSchema,
    timezone: baselineQuerySchema.shape.timezone,
    activity: activitySchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (
      d.conditions[0].toLowerCase() === d.conditions[1].toLowerCase() ||
      new Set(d.criteria.map((c) => c.metric)).size !== d.criteria.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Use two distinct conditions and unique criteria',
      });
    if (
      d.criteria.some(
        (c) => c.metric === 'focus_rating' && c.meaningfulDifference > 4,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Focus rating threshold must be at most four points',
      });
  });
export type ExperimentDefinition = z.infer<typeof experimentDefinitionSchema>;
export const experimentSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    status: experimentStatusSchema,
    definition: experimentDefinitionSchema,
  })
  .strict();
export type Experiment = z.infer<typeof experimentSchema>;
export const experimentIdSchema = z.uuid();
export const experimentRecordSchema = z
  .object({
    condition: z.string().trim().min(1).max(60),
    range: timelineQuerySchema.transform((range) => ({
      ...range,
      start: new Date(range.start).toISOString(),
      end: new Date(range.end).toISOString(),
    })),
    rating: z.number().int().min(1).max(5).nullable(),
    notes: z.string().trim().max(500).nullable(),
  })
  .strict();
export type ExperimentRecord = z.infer<typeof experimentRecordSchema>;
export const experimentMetricsSchema = z
  .object({
    session_duration: z.number().finite().positive().max(1560),
    focus_rating: z.number().int().min(1).max(5).nullable(),
    pulse_deviation: z.number().finite().nullable(),
    hrv_deviation: z.number().finite().nullable(),
  })
  .strict();
export const experimentSupportSchema = z
  .object({
    retrospective: z.boolean(),
    observedSeconds: z.number().int().nonnegative(),
    expectedSeconds: z.number().positive().max(93600),
    pulse: baselineComparisonSchema,
    hrv: baselineComparisonSchema,
  })
  .strict();
export const experimentSessionSchema = z
  .object({
    id: z.uuid(),
    experimentId: z.uuid(),
    recordedAt: z.iso.datetime(),
    input: experimentRecordSchema,
    metrics: experimentMetricsSchema,
    evidence: experimentSupportSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.metrics.focus_rating !== s.input.rating ||
      s.evidence.pulse.metric !== 'pulse' ||
      s.evidence.hrv.metric !== 'hrv' ||
      Math.abs(s.evidence.expectedSeconds - s.metrics.session_duration * 60) >
        1e-8 ||
      Math.abs(
        s.metrics.session_duration -
          (Date.parse(s.input.range.end) - Date.parse(s.input.range.start)) /
            60000,
      ) > 1e-8
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Session metrics must match their recorded input',
      });
    for (const metric of ['pulse', 'hrv'] as const) {
      const c = s.evidence[metric],
        value =
          s.metrics[metric === 'pulse' ? 'pulse_deviation' : 'hrv_deviation'];
      const expected =
        c.state === 'ready' &&
        c.currentCount >= 20 &&
        c.currentCount / s.evidence.expectedSeconds >= 0.5
          ? c.differencePercent
          : null;
      if (value !== expected)
        ctx.addIssue({
          code: 'custom',
          message:
            'Physiology needs sufficient matched baseline and session coverage',
        });
    }
  });
export type ExperimentSession = z.infer<typeof experimentSessionSchema>;
const conditionSummary = z
  .object({
    condition: z.string(),
    count: z.number().int().nonnegative(),
    dayCount: z.number().int().nonnegative(),
    mean: z.number().finite().nullable(),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  })
  .strict();
export const experimentComparisonSchema = z
  .object({
    metric: experimentMetricSchema,
    threshold: z.number().positive(),
    state: z.enum([
      'insufficient_data',
      'observed_association',
      'meaningful_difference',
      'no_meaningful_difference',
    ]),
    conditions: z.tuple([conditionSummary, conditionSummary]),
    difference: z.number().finite().nullable(),
    observedDifferenceRange: z
      .tuple([z.number().finite(), z.number().finite()])
      .nullable(),
  })
  .strict();
export type ExperimentComparison = z.infer<typeof experimentComparisonSchema>;
export const experimentDetailSchema = z
  .object({
    experiment: experimentSchema,
    sessions: z.array(experimentSessionSchema).max(200),
    comparisons: z.array(experimentComparisonSchema).min(1).max(4),
  })
  .strict()
  .superRefine((d, ctx) => {
    const def = d.experiment.definition;
    if (
      new Set(d.sessions.map((s) => s.id)).size !== d.sessions.length ||
      d.sessions.some(
        (s) =>
          s.experimentId !== d.experiment.id ||
          s.input.range.source !== def.source ||
          !def.conditions.includes(s.input.condition),
      ) ||
      d.comparisons.map((c) => c.metric).join(',') !==
        def.criteria.map((c) => c.metric).join(',') ||
      d.comparisons.some(
        (c, i) =>
          c.threshold !== def.criteria[i]!.meaningfulDifference ||
          JSON.stringify(c.conditions.map((c) => c.condition)) !==
            JSON.stringify(def.conditions),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Experiment report must match its definition and sessions',
      });
  });
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>;
export const experimentListSchema = z.array(experimentSchema).max(50);
export type ExperimentFailure =
  'not_configured' | 'unauthorized' | 'unavailable' | 'conflict' | 'not_found';
export type ExperimentResult<T> =
  { state: 'ready'; data: T } | { state: ExperimentFailure; data: null };
export const experimentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('get'), id: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('create'),
      definition: experimentDefinitionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('status'),
      id: z.uuid(),
      status: experimentStatusSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('record'),
      id: z.uuid(),
      input: experimentRecordSchema,
    })
    .strict(),
  z.object({ type: z.literal('remove'), id: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('remove_session'),
      id: z.uuid(),
      sessionId: z.uuid(),
    })
    .strict(),
]);
export type ExperimentAction = z.infer<typeof experimentActionSchema>;
export const experimentSnapshotSchema = z
  .object({
    experiments: experimentListSchema,
    selected: experimentDetailSchema.nullable(),
  })
  .strict();
export const experimentOutcomeSchema = z.discriminatedUnion('state', [
  z
    .object({ state: z.literal('ready'), data: experimentSnapshotSchema })
    .strict(),
  z
    .object({
      state: z.enum([
        'not_configured',
        'unauthorized',
        'unavailable',
        'conflict',
        'not_found',
      ]),
      data: z.null(),
    })
    .strict(),
]);
export type ExperimentOutcome = z.infer<typeof experimentOutcomeSchema>;
export type ExperimentSnapshot = z.infer<typeof experimentSnapshotSchema>;
export type ExperimentMetric = z.infer<typeof experimentMetricSchema>;
