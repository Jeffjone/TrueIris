import { z } from 'zod';
import { sensorReadingSchema } from './reading';

// Canonical second-aligned UTC timestamps make retry identity unambiguous.
export const measurementSchema = sensorReadingSchema
  .extend({
    eventId: z.uuid(),
    startedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const time = Date.parse(value.timestamp);
    if (time % 1000 !== 0 || value.timestamp !== new Date(time).toISOString())
      ctx.addIssue({
        code: 'custom',
        message: 'Timestamp must be canonical UTC seconds',
      });
    if (time < Date.parse(value.startedAt))
      ctx.addIssue({ code: 'custom', message: 'Measurement precedes session' });
  });
export type Measurement = z.infer<typeof measurementSchema>;
export const measurementBatchSchema = z
  .object({
    measurements: z.array(measurementSchema).min(1).max(120),
  })
  .strict();
export const ingestionAckSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
  })
  .strict();
export type IngestionAck = z.infer<typeof ingestionAckSchema>;
export const storageStatusSchema = z
  .object({
    enabled: z.boolean(),
    configured: z.boolean(),
    state: z.enum(['off', 'idle', 'saving', 'retrying', 'blocked']),
    queued: z.number().int().nonnegative(),
    saved: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    lastSavedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type StorageStatus = z.infer<typeof storageStatusSchema>;
export const exportCursorSchema = z
  .string()
  .max(200)
  .superRefine((value, ctx) => {
    const parts = value.split('|');
    if (
      parts.length !== 2 ||
      !z.iso.datetime().safeParse(parts[0]).success ||
      !z.uuid().safeParse(parts[1]).success ||
      !parts[0]?.endsWith('.000Z')
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid export cursor' });
  });
export const exportResultSchema = z.enum(['saved', 'cancelled', 'failed']);
export const deleteResultSchema = z.enum(['deleted', 'cancelled', 'failed']);
export const exportPageSchema = z
  .object({
    measurements: z.array(measurementSchema).max(500),
    next: exportCursorSchema.nullable(),
  })
  .strict();
