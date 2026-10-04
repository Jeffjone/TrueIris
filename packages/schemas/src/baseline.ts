import { z } from 'zod';
import { activitySchema } from './activity';
import { timelineQuerySchema } from './timeline';

export const baselineContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('activity'), activity: activitySchema }).strict(),
  z
    .object({
      kind: z.literal('time_of_day'),
      period: z.enum(['night', 'morning', 'afternoon', 'evening']),
    })
    .strict(),
]);
export type BaselineContext = z.infer<typeof baselineContextSchema>;
const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    try {
      if (/^[+-]/.test(zone)) return false;
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');
export const baselineQuerySchema = z
  .object({
    range: timelineQuerySchema,
    context: baselineContextSchema,
    timezone: timezoneSchema,
    lookbackDays: z.number().int().min(1).max(30),
  })
  .strict();
export type BaselineQuery = z.infer<typeof baselineQuerySchema>;
export const baselineEvidenceSchema = z
  .object({
    sampleCount: z.number().int().nonnegative(),
    dayCount: z.number().int().nonnegative(),
    mean: z.number().finite().nullable(),
    variance: z.number().finite().nonnegative().nullable(),
    measurementConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type BaselineEvidence = z.infer<typeof baselineEvidenceSchema>;
export const baselineComparisonSchema = z
  .object({
    metric: z.enum(['pulse', 'respiration', 'hrv']),
    current: z.number().finite().nullable(),
    currentCount: z.number().int().nonnegative(),
    baseline: z.number().finite().nullable(),
    differenceAbsolute: z.number().finite().nullable(),
    differencePercent: z.number().finite().nullable(),
    deviation: z.number().finite().nullable(),
    sampleCount: z.number().int().nonnegative(),
    dayCount: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    state: z.enum(['ready', 'insufficient_history', 'no_current_data']),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCurrent = value.current !== null && value.currentCount > 0;
    const validCurrent =
      (value.current === null) === (value.currentCount === 0);
    const hasBaseline = value.baseline !== null;
    const expectedState = !hasBaseline
      ? 'insufficient_history'
      : !hasCurrent
        ? 'no_current_data'
        : 'ready';
    const hasDifference = value.differenceAbsolute !== null;
    if (
      !validCurrent ||
      value.state !== expectedState ||
      hasDifference !== (hasBaseline && hasCurrent) ||
      (!hasDifference &&
        (value.differencePercent !== null || value.deviation !== null)) ||
      (!hasBaseline && value.confidence !== 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent baseline evidence state',
      });
    }
  });

export type BaselineComparison = z.infer<typeof baselineComparisonSchema>;
export const baselineDataSchema = z
  .object({
    query: baselineQuerySchema,
    historyStart: z.iso.datetime(),
    historyEnd: z.iso.datetime(),
    comparisons: z
      .tuple([
        baselineComparisonSchema,
        baselineComparisonSchema,
        baselineComparisonSchema,
      ])
      .refine(
        (items) =>
          items.map((c) => c.metric).join(',') === 'pulse,respiration,hrv',
        'Invalid metric order',
      ),
  })
  .strict();
export type BaselineData = z.infer<typeof baselineDataSchema>;
export const baselineResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), data: baselineDataSchema }).strict(),
  z
    .object({
      state: z.enum(['unavailable', 'unauthorized', 'not_configured']),
      data: z.null(),
    })
    .strict(),
]);
export type BaselineResult = z.infer<typeof baselineResultSchema>;
