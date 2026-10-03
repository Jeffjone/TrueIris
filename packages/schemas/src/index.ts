import { z } from 'zod';

export const integrationStateSchema = z.enum([
  'not_implemented',
  'unavailable',
  'ready',
]);
export const healthSchema = z
  .object({
    service: z.literal('trueiris-api'),
    status: z.literal('ok'),
    timestamp: z.iso.datetime(),
    integrations: z
      .object({
        database: integrationStateSchema,
        reasoning: integrationStateSchema,
        voice: integrationStateSchema,
      })
      .strict(),
  })
  .strict();
export type ApiHealth = z.infer<typeof healthSchema>;

export const desktopStatusSchema = z
  .object({
    version: z.string(),
    api: z.enum(['connected', 'unavailable']),
    demoMode: z.boolean(),
    integrations: healthSchema.shape.integrations.nullable(),
  })
  .strict();
export type DesktopStatus = z.infer<typeof desktopStatusSchema>;

export const dataSourceSchema = z.enum(['live', 'mock', 'demo_seed']);
export const sensorReadingSchema = z
  .object({
    timestamp: z.iso.datetime(),
    sessionId: z.uuid(),
    source: dataSourceSchema,
    pulseRate: z.number().positive().optional(),
    pulseConfidence: z.number().min(0).max(1).optional(),
    respirationRate: z.number().nonnegative().optional(),
    respirationConfidence: z.number().min(0).max(1).optional(),
    hrvRmssd: z.number().nonnegative().optional(),
    hrvConfidence: z.number().min(0).max(1).optional(),
    talking: z.boolean().optional(),
    signalQuality: z.enum(['excellent', 'good', 'poor', 'unavailable']),
  })
  .strict();
export type SensorReading = z.infer<typeof sensorReadingSchema>;
