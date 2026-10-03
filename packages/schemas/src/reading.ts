import { z } from 'zod';

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
