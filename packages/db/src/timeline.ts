import type { Pool, PoolClient } from 'pg';
import {
  timelineQuerySchema,
  timelineDataSchema,
  contextIntervalSchema,
  type TimelineQuery,
} from '@trueiris/schemas';

// The same eligibility rules as epochs/Live: never turn withheld values into zero.
const readings = `WITH eligible AS (
  SELECT timestamp,session_id,activity,
    CASE WHEN signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND pulse_confidence >= 0.4 THEN pulse_rate END AS pulse,
    CASE WHEN signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND breathing_confidence >= 0.45 THEN breathing_rate END AS respiration,
    CASE WHEN signal_quality IN ('good','excellent') AND talking IS NOT TRUE AND hrv_confidence >= 0.5 THEN hrv_rmssd END AS hrv,
    pulse_confidence,breathing_confidence,hrv_confidence
  FROM measurements WHERE user_id=$1 AND source=$2 AND timestamp >= $3 AND timestamp < $4
)`;
function stats(metric: string, confidence: string) {
  return `jsonb_build_object('count',count(${metric})::int,'mean',avg(${metric}),'min',min(${metric}),'max',max(${metric}),'confidence',avg(${confidence}) FILTER (WHERE ${metric} IS NOT NULL))`;
}
const metrics = `${stats('pulse', 'pulse_confidence')} AS pulse,${stats('respiration', 'breathing_confidence')} AS respiration,${stats('hrv', 'hrv_confidence')} AS hrv`;
const ordered = `, ordered AS (
  SELECT *, lag(timestamp) OVER w AS previous, lag(activity) OVER w AS previous_activity
  FROM eligible WINDOW w AS (PARTITION BY session_id ORDER BY timestamp)
), islands AS (
  SELECT *,sum(CASE WHEN previous IS NULL OR timestamp > previous + interval '1 second' OR activity IS DISTINCT FROM previous_activity THEN 1 ELSE 0 END)
  OVER (PARTITION BY session_id ORDER BY timestamp) AS island FROM ordered
)`;
const iso = (value: Date) => value.toISOString();

/** One repeatable-read snapshot, exact scoped summary and bounded display detail. */
export async function queryTimeline(
  pool: Pool,
  userId: string,
  input: TimelineQuery,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await queryTimelineInTransaction(client, userId, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
/** Reuse an already owner-locked transaction without acquiring another pool connection. */
export async function queryTimelineInTransaction(
  client: PoolClient,
  userId: string,
  input: TimelineQuery,
) {
  const range = timelineQuerySchema.parse(input);
  const params = [userId, range.source, range.start, range.end];
  const points = await client.query(
    `${readings}
    SELECT date_bin(interval '30 seconds',timestamp,timestamptz '2000-01-01 00:00:00+00') AS bucket,
      session_id,min(timestamp) AS first,max(timestamp) AS last,count(*)::int AS count,${metrics}
    FROM eligible GROUP BY bucket,session_id ORDER BY bucket,session_id LIMIT 6001`,
    params,
  );
  const activities = await client.query(
    `${readings}${ordered}
    SELECT min(timestamp) AS start,least(max(timestamp)+interval '1 second',$4::timestamptz) AS end,session_id,activity
    FROM islands GROUP BY session_id,island,activity ORDER BY start,session_id LIMIT 3001`,
    params,
  );
  const gaps = await client.query(
    `${readings}, ordered AS (
    SELECT *,lag(timestamp) OVER w AS previous,
      (pulse IS NULL AND respiration IS NULL AND hrv IS NULL) AS withheld,
      lag(pulse IS NULL AND respiration IS NULL AND hrv IS NULL) OVER w AS previous_withheld
    FROM eligible WINDOW w AS (PARTITION BY session_id ORDER BY timestamp)
  ), islands AS (
    SELECT *,sum(CASE WHEN previous IS NULL OR timestamp > previous + interval '1 second' OR withheld IS DISTINCT FROM previous_withheld THEN 1 ELSE 0 END)
    OVER (PARTITION BY session_id ORDER BY timestamp) AS island FROM ordered
  ), gaps AS (
    SELECT previous+interval '1 second' AS start,timestamp AS end,session_id,'missing' AS kind
    FROM ordered WHERE timestamp > previous+interval '1 second'
    UNION ALL
    SELECT min(timestamp),least(max(timestamp)+interval '1 second',$4::timestamptz),session_id,'withheld'
    FROM islands WHERE withheld GROUP BY session_id,island
  ) SELECT * FROM gaps ORDER BY start,session_id LIMIT 3001`,
    params,
  );
  const summary = await client.query(
    `${readings} SELECT count(*)::int AS count,count(DISTINCT timestamp)::int AS "observedSeconds",count(DISTINCT session_id)::int AS sessions,${metrics} FROM eligible`,
    params,
  );
  const contexts = await client.query<{
    payload: unknown;
    start_time: Date;
    end_time: Date;
  }>(
    `SELECT payload,greatest(start_time,$3::timestamptz) AS start_time,least(end_time,$4::timestamptz) AS end_time FROM context_intervals WHERE user_id=$1 AND source=$2 AND start_time<$4 AND end_time>$3 ORDER BY start_time,id LIMIT 3001`,
    params,
  );
  const result = timelineDataSchema.parse({
    range,
    contexts: contexts.rows.slice(0, 3000).map((row) => ({
      ...contextIntervalSchema.parse(row.payload),
      start: iso(row.start_time),
      end: iso(row.end_time),
    })),
    points: points.rows.slice(0, 6000).map((p) => ({
      start: iso(
        new Date(Math.max(p.bucket.getTime(), Date.parse(range.start))),
      ),
      end: iso(
        new Date(Math.min(p.bucket.getTime() + 30_000, Date.parse(range.end))),
      ),
      first: iso(p.first),
      last: iso(p.last),
      sessionId: p.session_id,
      count: p.count,
      pulse: p.pulse,
      respiration: p.respiration,
      hrv: p.hrv,
    })),
    activities: activities.rows.slice(0, 3000).map((p) => ({
      start: iso(p.start),
      end: iso(p.end),
      sessionId: p.session_id,
      activity: p.activity,
    })),
    gaps: gaps.rows.slice(0, 3000).map((p) => ({
      start: iso(p.start),
      end: iso(p.end),
      sessionId: p.session_id,
      kind: p.kind,
    })),
    summary: summary.rows[0],
    limited:
      points.rows.length > 6000 ||
      activities.rows.length > 3000 ||
      gaps.rows.length > 3000 ||
      contexts.rows.length > 3000,
  });
  return result;
}
