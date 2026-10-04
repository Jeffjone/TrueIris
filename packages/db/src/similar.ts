import type { Pool } from 'pg';
import {
  similarQuerySchema,
  similarDataSchema,
  type SimilarQuery,
} from '@trueiris/schemas';
/** Recent activity-matched sensing periods, not semantic/causal similarity. */
export async function querySimilarSessions(
  pool: Pool,
  userId: string,
  input: SimilarQuery,
) {
  const query = similarQuerySchema.parse(input);
  const result = await pool.query(
    `
    SELECT min(timestamp) AS start, least(max(timestamp) + interval '1 second', $4::timestamptz) AS end, count(*)::int AS count,
      avg(pulse_rate) FILTER (WHERE signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND pulse_confidence >= 0.4) AS pulse,
      avg(breathing_rate) FILTER (WHERE signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND breathing_confidence >= 0.45) AS respiration,
      avg(hrv_rmssd) FILTER (WHERE signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND hrv_confidence >= 0.5) AS hrv
    FROM measurements WHERE user_id=$1 AND source=$2 AND timestamp >= $3 AND timestamp < $4
      AND ($5::text IS NULL OR activity=$5)
    GROUP BY session_id HAVING least(max(timestamp) + interval '1 second', $4::timestamptz)-min(timestamp) <= interval '26 hours'
    ORDER BY max(timestamp) DESC, session_id LIMIT $6`,
    [
      userId,
      query.source,
      query.range.start,
      query.range.end,
      query.activity,
      query.limit,
    ],
  );
  return similarDataSchema.parse({
    query,
    sessions: result.rows.map((r) => ({
      range: {
        start: r.start.toISOString(),
        end: r.end.toISOString(),
        source: query.source,
      },
      activity: query.activity,
      count: r.count,
      pulse: r.pulse,
      respiration: r.respiration,
      hrv: r.hrv,
    })),
  });
}
