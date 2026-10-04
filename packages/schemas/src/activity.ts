import { z } from 'zod';
export const activitySchema = z.enum([
  'Coding',
  'Studying',
  'Reading',
  'Meeting',
  'Break',
  'Other',
]);
export type RecordedActivity = z.infer<typeof activitySchema>;
