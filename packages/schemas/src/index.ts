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

export * from './reading';
export * from './sensor';
export * from './storage';
export * from './timeline';

export * from './context';
export * from './baseline';
export * from './reasoning';

export * from './voice';
