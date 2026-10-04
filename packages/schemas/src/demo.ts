import { z } from 'zod';
import { activitySchema } from './activity';
import { timelineQuerySchema } from './timeline';
const seededRange = timelineQuerySchema.refine(
  (r) => r.source === 'demo_seed',
  'Demo evidence must be seeded',
);
export const demoEpisodeSchema = z
  .object({
    id: z.uuid(),
    range: seededRange,
    activity: activitySchema,
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    tags: z.array(z.string().min(1).max(60)).max(8),
    readings: z.number().int().positive(),
    pulse: z.number().finite().positive(),
    hrv: z.number().finite().nonnegative(),
  })
  .strict();
export const demoDatasetSchema = z
  .object({
    source: z.literal('demo_seed'),
    version: z.literal('demo-v1'),
    generatedAt: z.iso.datetime(),
    historyStart: z.iso.datetime(),
    historyEnd: z.iso.datetime(),
    timezone: z.literal('UTC'),
    measurementCount: z.number().int().positive().max(100_000),
    contextCount: z.number().int().positive().max(5000),
    episodes: z.array(demoEpisodeSchema).min(7).max(48),
    patterns: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            description: z.string().min(1).max(700),
            episodeIds: z.array(z.uuid()).min(1).max(48),
            sessionCount: z.number().int().positive(),
            dayCount: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    experimentIds: z.array(z.uuid()).min(1).max(3),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = new Set(data.episodes.map((e) => e.id));
    if (
      ids.size !== data.episodes.length ||
      data.patterns.some((p) => p.episodeIds.some((id) => !ids.has(id))) ||
      Date.parse(data.historyStart) >= Date.parse(data.historyEnd) ||
      Date.parse(data.historyEnd) > Date.parse(data.generatedAt) ||
      data.episodes.some(
        (e) =>
          e.range.start < data.historyStart || e.range.end > data.historyEnd,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Demo artifacts must reference their seeded evidence',
      });
    }
  });
export type DemoDataset = z.infer<typeof demoDatasetSchema>;
export type DemoEpisode = z.infer<typeof demoEpisodeSchema>;
export const demoStateSchema = z.enum([
  'preparing',
  'ready',
  'empty',
  'unavailable',
]);
export const demoOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), data: demoDatasetSchema }).strict(),
  z
    .object({
      state: z.enum([
        'preparing',
        'empty',
        'unavailable',
        'not_configured',
        'unauthorized',
        'disabled',
      ]),
      data: z.null(),
    })
    .strict(),
]);
export type DemoOutcome = z.infer<typeof demoOutcomeSchema>;
