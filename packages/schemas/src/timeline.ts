import { z } from 'zod';
import { dataSourceSchema } from './reading';

export const activitySchema = z.enum([
  'Coding',
  'Studying',
  'Reading',
  'Meeting',
  'Break',
  'Other',
]);
export type RecordedActivity = z.infer<typeof activitySchema>;
export const timelineQuerySchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    source: dataSourceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const duration = Date.parse(value.end) - Date.parse(value.start);
    if (duration <= 0 || duration > 26 * 3600_000)
      ctx.addIssue({
        code: 'custom',
        message: 'Select a positive range of at most 26 hours',
      });
  });
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
const statsSchema = z
  .object({
    count: z.number().int().nonnegative(),
    mean: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export const timelinePointSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    first: z.iso.datetime(),
    last: z.iso.datetime(),
    sessionId: z.uuid(),
    count: z.number().int().positive(),
    pulse: statsSchema,
    respiration: statsSchema,
    hrv: statsSchema,
  })
  .strict();
export const activityPeriodSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    sessionId: z.uuid(),
    activity: activitySchema.nullable(),
  })
  .strict();
export const signalGapSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    sessionId: z.uuid(),
    kind: z.enum(['missing', 'withheld']),
  })
  .strict();
export const timelineDataSchema = z
  .object({
    range: timelineQuerySchema,
    points: z.array(timelinePointSchema).max(6000),
    activities: z.array(activityPeriodSchema).max(3000),
    gaps: z.array(signalGapSchema).max(3000),
    summary: z
      .object({
        count: z.number().int().nonnegative(),
        observedSeconds: z.number().int().nonnegative(),
        sessions: z.number().int().nonnegative(),
        pulse: statsSchema,
        respiration: statsSchema,
        hrv: statsSchema,
      })
      .strict(),
    limited: z.boolean(),
  })
  .strict();
export type TimelineData = z.infer<typeof timelineDataSchema>;
export type TimelinePoint = z.infer<typeof timelinePointSchema>;
export type ActivityPeriod = z.infer<typeof activityPeriodSchema>;
export type SignalGap = z.infer<typeof signalGapSchema>;
export const timelineResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), data: timelineDataSchema }).strict(),
  z
    .object({
      state: z.enum(['unavailable', 'unauthorized', 'not_configured']),
      data: z.null(),
    })
    .strict(),
]);
export type TimelineResult = z.infer<typeof timelineResultSchema>;
