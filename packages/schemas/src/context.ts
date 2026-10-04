import { z } from 'zod';
import { activitySchema } from './activity';
import { dataSourceSchema } from './reading';
import { storageStatusSchema } from './storage';

export const applicationSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
  })
  .strict();
export const classificationSchema = z
  .object({
    activity: activitySchema,
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(256),
  })
  .strict();
export type ActivityClassification = z.infer<typeof classificationSchema>;
export const contextOptionsSchema = z
  .object({
    windowTitles: z.boolean(),
    focusMode: z.boolean(),
  })
  .strict();
export type ContextOptions = z.infer<typeof contextOptionsSchema>;
export const foregroundSchema = z
  .object({
    application: applicationSchema.nullable(),
    windowTitle: z.string().max(512).nullable(),
    titleAccess: z.enum(['off', 'ready', 'permission_required', 'unavailable']),
  })
  .strict();
export type Foreground = z.infer<typeof foregroundSchema>;
export const contextSnapshotSchema = z
  .object({
    phase: z.enum(['off', 'starting', 'running', 'error']),
    provider: z.enum(['desktop', 'mock']),
    issue: z.enum(['none', 'unsupported', 'unavailable']),
    sessionId: z.uuid().nullable(),
    startedAt: z.iso.datetime().nullable(),
    timestamp: z.iso.datetime().nullable(),
    application: applicationSchema.nullable(),
    windowTitle: z.string().max(512).nullable(),
    titleAccess: foregroundSchema.shape.titleAccess,
    options: contextOptionsSchema,
    manualActivity: activitySchema.nullable(),
    classification: classificationSchema.nullable(),
    idleSeconds: z.number().int().nonnegative(),
    sessionSeconds: z.number().int().nonnegative(),
    applicationSwitches: z.number().int().nonnegative(),
    foregroundSeconds: z.number().int().nonnegative(),
    storage: storageStatusSchema,
  })
  .strict();
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
// Closed, immutable half-open intervals. Millisecond UTC timestamps retain exact consent boundaries.
export const contextIntervalSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    source: dataSourceSchema,
    startedAt: z.iso.datetime(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    application: applicationSchema.nullable(),
    windowTitle: z.string().max(512).nullable(),
    manualActivity: activitySchema.nullable(),
    classification: classificationSchema.nullable(),
    idle: z.boolean(),
    idleSeconds: z.number().int().nonnegative(),
    sessionSeconds: z.number().int().nonnegative(),
    applicationSwitches: z.number().int().nonnegative(),
    focusMode: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.start),
      end = Date.parse(value.end);
    if (
      start < Date.parse(value.startedAt) ||
      end <= start ||
      end - start > 30_000
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid context interval bounds',
      });
    for (const time of [value.startedAt, value.start, value.end])
      if (new Date(Date.parse(time)).toISOString() !== time)
        ctx.addIssue({
          code: 'custom',
          message: 'Context timestamps must be canonical UTC',
        });
    if (
      !value.application &&
      (value.windowTitle !== null || value.classification !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Unobserved application cannot carry inferred context',
      });
  });
export type ContextInterval = z.infer<typeof contextIntervalSchema>;
export const contextBatchSchema = z
  .object({ intervals: z.array(contextIntervalSchema).min(1).max(60) })
  .strict();
export const contextCursorSchema = z
  .string()
  .max(200)
  .superRefine((value, ctx) => {
    const [time, id, extra] = value.split('|');
    if (
      extra !== undefined ||
      !z.iso.datetime().safeParse(time).success ||
      !z.uuid().safeParse(id).success ||
      !time ||
      !Number.isFinite(Date.parse(time)) ||
      new Date(Date.parse(time)).toISOString() !== time
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid context cursor' });
  });
export const contextExportPageSchema = z
  .object({
    intervals: z.array(contextIntervalSchema).max(500),
    next: contextCursorSchema.nullable(),
  })
  .strict();
// Timeline bounds are clipped to the query; session metadata remains the original observation.
export const timelineContextSchema = contextIntervalSchema;
