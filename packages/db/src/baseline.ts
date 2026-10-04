import type { Pool } from 'pg';
import { compareAgainstBaseline } from '@trueiris/analytics';
import {
  baselineQuerySchema,
  baselineDataSchema,
  type BaselineQuery,
} from '@trueiris/schemas';

/** Bounded, owner/source scoped query. No chart caps or rounded chart statistics. */
export async function queryBaselines(
  pool: Pool,
  userId: string,
  input: BaselineQuery,
) {
  const query = baselineQuerySchema.parse(input);
  const historyStart = new Date(
    Date.parse(query.range.start) - query.lookbackDays * 86400_000,
  ).toISOString();
  const activity =
    query.context.kind === 'activity' ? query.context.activity : null;
  const period =
    query.context.kind === 'time_of_day'
      ? ['night', 'morning', 'afternoon', 'evening'].indexOf(
          query.context.period,
        )
      : null;
  const result = await pool.query<{
    metric: 'pulse' | 'respiration' | 'hrv';
    sample_count: number;
    day_count: number;
    mean: number | null;
    variance: number | null;
    confidence: number | null;
    current: number | null;
    current_count: number;
  }>(
    `
    WITH scoped AS (
      SELECT m.*, (m.timestamp AT TIME ZONE $6)::date AS local_day,
        m.timestamp < $3::timestamptz AS historical
      FROM measurements m
      WHERE m.user_id=$1 AND m.source=$2 AND m.timestamp >= $4::timestamptz AND m.timestamp < $5::timestamptz
        AND m.signal_quality IN ('good','excellent') AND NOT COALESCE(m.talking,false)
        AND ($7::text IS NULL OR COALESCE(m.activity, (
          SELECT CASE WHEN count(*)=1 THEN min(COALESCE(c.payload->>'manualActivity',
            CASE WHEN NOT (c.payload->>'idle')::boolean AND (c.payload->'classification'->>'confidence')::float8 >= 0.8
            THEN c.payload->'classification'->>'activity' END)) END
          FROM context_intervals c WHERE c.user_id=$1 AND c.source=$2
            AND c.start_time > m.timestamp - interval '30 seconds'
            AND c.start_time <= m.timestamp AND c.end_time > m.timestamp
        )) = $7)
        AND ($8::int IS NULL OR floor(extract(hour FROM m.timestamp AT TIME ZONE $6)/6)::int=$8)
    ), readings AS (
      SELECT session_id, timestamp, local_day, historical, v.* FROM scoped
      CROSS JOIN LATERAL (VALUES
        ('pulse', pulse_rate, pulse_confidence, 0.4),
        ('respiration', breathing_rate, breathing_confidence, 0.45),
        ('hrv', hrv_rmssd, hrv_confidence, 0.5)
      ) v(metric,value,confidence,threshold)
      WHERE value IS NOT NULL AND confidence >= threshold
    ), buckets AS (
      SELECT metric, session_id, date_bin('30 seconds',timestamp,'1970-01-01'::timestamptz),
        min(local_day) AS local_day, avg(value) AS value, avg(confidence) AS confidence
      FROM readings WHERE historical GROUP BY 1,2,3 HAVING count(*) >= 15
    ), history AS (
      SELECT metric, count(*)::int AS sample_count, count(DISTINCT local_day)::int AS day_count,
        avg(value) AS mean, var_pop(value) AS variance, avg(confidence) AS confidence
      FROM buckets GROUP BY metric
    ), current_stats AS (
      SELECT metric, avg(value) AS current, count(*)::int AS current_count FROM readings WHERE NOT historical GROUP BY metric
    )
    SELECT metrics.metric, COALESCE(h.sample_count,0) AS sample_count, COALESCE(h.day_count,0) AS day_count,
      h.mean, h.variance, h.confidence, c.current, COALESCE(c.current_count,0) AS current_count
    FROM (VALUES ('pulse'),('respiration'),('hrv')) metrics(metric)
      LEFT JOIN history h USING(metric) LEFT JOIN current_stats c USING(metric)
    ORDER BY CASE metrics.metric WHEN 'pulse' THEN 0 WHEN 'respiration' THEN 1 ELSE 2 END
    `,
    [
      userId,
      query.range.source,
      query.range.start,
      historyStart,
      query.range.end,
      query.timezone,
      activity,
      period,
    ],
  );
  const comparisons = result.rows.map((r) =>
    compareAgainstBaseline(
      r.metric,
      r.current,
      r.current_count,
      {
        sampleCount: r.sample_count,
        dayCount: r.day_count,
        mean: r.mean,
        variance: r.variance === null ? null : Math.max(0, r.variance),
        measurementConfidence: r.confidence,
      },
      query.context,
    ),
  );
  return baselineDataSchema.parse({
    query,
    historyStart,
    historyEnd: query.range.start,
    comparisons,
  });
}
