import { z } from 'zod';
import { dataSourceSchema, sensorReadingSchema } from './reading';
import { activitySchema } from './activity';
import { timelineQuerySchema } from './timeline';
import { baselineQuerySchema } from './baseline';

export const metricSchema = z.enum(['pulse', 'respiration', 'hrv']);
export const reasoningProviderSchema = z.enum(['gemini', 'mock']);
export const reasoningTimezoneSchema = baselineQuerySchema.shape.timezone;
export const currentStateSchema = z
  .object({
    sensor: z.enum(['off', 'starting', 'running', 'stopping', 'error']),
    reading: sensorReadingSchema.nullable(),
    contextSource: dataSourceSchema,
    context: z.enum(['off', 'starting', 'running', 'error']),
    application: z.string().max(256).nullable(),
    activity: activitySchema.nullable(),
    saving: z.boolean(),
  })
  .strict();
export type CurrentState = z.infer<typeof currentStateSchema>;
export const askQuerySchema = z
  .object({
    question: z.string().trim().min(1).max(1500),
    reconstructionRange: timelineQuerySchema.optional(),
    source: dataSourceSchema,
    timezone: reasoningTimezoneSchema,
  })
  .strict();
export type AskQuery = z.infer<typeof askQuerySchema>;
export const askRequestSchema = askQuerySchema
  .extend({ current: currentStateSchema })
  .strict()
  .refine(
    (r) =>
      !r.reconstructionRange ||
      (r.question === 'What happened here?' &&
        r.reconstructionRange.source === r.source),
    'Reconstruction must use its selected source and question',
  );
export type AskRequest = z.infer<typeof askRequestSchema>;
/** Canonical text command and its common punctuation variants share one bounded workflow. */
export function isRecentExplanation(question: string): boolean {
  return /^(?:iris[,:]?\s+)?explain\s+(?:the\s+)?last\s+30\s+minutes[.!?]?$/i.test(
    question.trim(),
  );
}
export function recentExplanationRange(query: AskQuery, asOf: string) {
  return isRecentExplanation(query.question)
    ? timelineQuerySchema.parse({
        start: new Date(Date.parse(asOf) - 30 * 60_000).toISOString(),
        end: asOf,
        source: query.source,
      })
    : null;
}
export function requestedExplanationRange(query: AskQuery, asOf: string) {
  return query.reconstructionRange ?? recentExplanationRange(query, asOf);
}
export const historyRangeSchema = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .strict()
  .refine(
    (r) =>
      Date.parse(r.end) > Date.parse(r.start) &&
      Date.parse(r.end) - Date.parse(r.start) <= 30 * 86400_000,
    'History range must be positive and at most 30 days',
  );
export const similarQuerySchema = z
  .object({
    range: historyRangeSchema,
    source: dataSourceSchema,
    activity: activitySchema.nullable(),
    limit: z.number().int().min(1).max(5),
  })
  .strict();
export type SimilarQuery = z.infer<typeof similarQuerySchema>;
export const sessionEvidenceSchema = z
  .object({
    range: timelineQuerySchema,
    activity: activitySchema.nullable(),
    count: z.number().int().positive(),
    pulse: z.number().nullable(),
    respiration: z.number().nullable(),
    hrv: z.number().nullable(),
  })
  .strict();
export const similarDataSchema = z
  .object({
    query: similarQuerySchema,
    sessions: z.array(sessionEvidenceSchema).max(5),
  })
  .strict();
export type SimilarData = z.infer<typeof similarDataSchema>;
export const factSchema = z
  .object({
    id: z.string().regex(/^e\d+\.f\d+$/),
    text: z.string().min(1).max(1200),
    value: z.number().finite().nullable(),
    range: timelineQuerySchema.nullable(),
  })
  .strict();
export type EvidenceFact = z.infer<typeof factSchema>;
export const evidenceSchema = z
  .object({
    id: z.string().regex(/^e\d+$/),
    tool: z.enum([
      'reconstruct_events',
      'get_current_state',
      'get_metrics',
      'get_context',
      'compare_baseline',
      'get_daily_summary',
      'find_similar_sessions',
      'search_memories',
    ]),
    title: z.string().min(1).max(160),
    range: timelineQuerySchema.nullable(),
    status: z.enum(['ready', 'empty', 'limited', 'unavailable']),
    facts: z.array(factSchema).min(1).max(24),
    limitations: z.array(factSchema.shape.id).max(24),
  })
  .strict();
export type AgentEvidence = z.infer<typeof evidenceSchema>;
export const respondSchema = z
  .object({ factIds: z.array(factSchema.shape.id).min(1).max(12) })
  .strict();
export const INCOMPLETE_ANSWER_PREFIX =
  'Iris could not finish this request. The retrieved evidence is shown below.\n\n';
export const agentDataSchema = z
  .object({
    query: askQuerySchema,
    provider: reasoningProviderSchema,
    asOf: z.iso.datetime(),
    explanationRange: timelineQuerySchema.nullable(),
    answer: z.string().min(1).max(16000),
    selectedFacts: z.array(factSchema).min(1).max(12),
    evidence: z.array(evidenceSchema).min(1).max(12),
  })
  .strict()
  .superRefine((data, ctx) => {
    const evidenceIds = new Set<string>(),
      facts = new Map<string, EvidenceFact>();
    const expectedRange = requestedExplanationRange(data.query, data.asOf);
    let valid =
      (!data.query.reconstructionRange ||
        (data.query.question === 'What happened here?' &&
          data.query.reconstructionRange.source === data.query.source &&
          Date.parse(data.query.reconstructionRange.end) <=
            Date.parse(data.asOf) + 1000)) &&
      JSON.stringify(data.explanationRange) === JSON.stringify(expectedRange);
    for (const evidence of data.evidence) {
      if (evidenceIds.has(evidence.id)) valid = false;
      evidenceIds.add(evidence.id);
      for (const id of evidence.limitations)
        if (!evidence.facts.some((f) => f.id === id)) valid = false;
      for (const fact of evidence.facts) {
        if (!fact.id.startsWith(`${evidence.id}.`) || facts.has(fact.id))
          valid = false;
        facts.set(fact.id, fact);
      }
      for (const range of [
        evidence.range,
        ...evidence.facts.map((f) => f.range),
      ])
        if (
          range &&
          (range.source !== data.query.source ||
            Date.parse(range.end) > Date.parse(data.asOf) + 1000)
        )
          valid = false;
    }
    const selectedIds = new Set<string>();
    for (const fact of data.selectedFacts) {
      if (
        selectedIds.has(fact.id) ||
        JSON.stringify(facts.get(fact.id)) !== JSON.stringify(fact)
      )
        valid = false;
      selectedIds.add(fact.id);
    }
    const body = data.selectedFacts.map((f) => f.text).join('\n\n');
    if (
      !valid ||
      (data.answer !== body && data.answer !== INCOMPLETE_ANSWER_PREFIX + body)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Answer must trace to scoped, unique evidence facts',
      });
  });

export type AgentData = z.infer<typeof agentDataSchema>;
export const agentResultSchema = z.discriminatedUnion('state', [
  z
    .object({ state: z.enum(['ready', 'partial']), data: agentDataSchema })
    .strict(),
  z
    .object({
      state: z.enum([
        'not_configured',
        'unauthorized',
        'unavailable',
        'busy',
        'cancelled',
      ]),
      data: z.null(),
    })
    .strict(),
]);
export type AgentResult = z.infer<typeof agentResultSchema>;

export const reconstructionQuerySchema = z
  .object({ range: timelineQuerySchema, timezone: reasoningTimezoneSchema })
  .strict();
export type ReconstructionQuery = z.infer<typeof reconstructionQuerySchema>;
