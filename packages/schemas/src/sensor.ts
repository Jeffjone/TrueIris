import { z } from 'zod';
import { sensorReadingSchema } from './reading';

export const sensorProviderSchema = z.enum(['presage', 'mock']);
export type SensorProviderKind = z.infer<typeof sensorProviderSchema>;
export const sensorIssueSchema = z.enum([
  'none',
  'calibrating',
  'no_face',
  'multiple_faces',
  'positioning',
  'lighting',
  'motion',
  'talking',
  'low_confidence',
  'stale',
  'missing_key',
  'permission_denied',
  'no_camera',
  'unsupported_platform',
  'sdk_unavailable',
  'authentication',
  'network',
  'processing',
]);
export type SensorIssue = z.infer<typeof sensorIssueSchema>;
export const sensorSnapshotSchema = z
  .object({
    provider: sensorProviderSchema,
    phase: z.enum(['off', 'starting', 'running', 'stopping', 'error']),
    issue: sensorIssueSchema,
    reading: sensorReadingSchema.nullable(),
    sessionId: z.uuid().nullable(),
    // Main-owned UTC start assigned on provider readiness; null outside a session.
    startedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type SensorSnapshot = z.infer<typeof sensorSnapshotSchema>;
export const sensorStartSchema = z
  .object({ provider: sensorProviderSchema })
  .strict();
export const sensorEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }).strict(),
  z
    .object({ kind: z.literal('reading'), reading: sensorReadingSchema })
    .strict(),
  z.object({ kind: z.literal('issue'), issue: sensorIssueSchema }).strict(),
  z.object({ kind: z.literal('error'), issue: sensorIssueSchema }).strict(),
]);
export type SensorEvent = z.infer<typeof sensorEventSchema>;
