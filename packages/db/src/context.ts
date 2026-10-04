import type { Pool, PoolClient } from 'pg';
import {
  contextBatchSchema,
  contextCursorSchema,
  contextIntervalSchema,
  type ContextInterval,
} from '@trueiris/schemas';

export class ContextConflict extends Error {}
/** Runs under the same per-owner transaction lock as measurement ingestion/deletion. */
export async function insertContext(
  client: PoolClient,
  userId: string,
  input: ContextInterval[],
) {
  const { intervals } = contextBatchSchema.parse({ intervals: input });
  const unique = new Map<string, ContextInterval>();
  for (const interval of intervals) {
    const previous = unique.get(interval.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(interval))
      throw new ContextConflict();
    unique.set(interval.id, interval);
  }
  const params = [JSON.stringify([...unique.values()]), userId];
  const incoming = `WITH incoming AS (SELECT value AS payload,(value->>'id')::uuid AS id,(value->>'sessionId')::uuid AS session_id,value->>'source' AS source,(value->>'startedAt')::timestamptz AS started_at,(value->>'start')::timestamptz AS start_time,(value->>'end')::timestamptz AS end_time FROM jsonb_array_elements($1::jsonb))`;
  const cutoff = await client.query(
    `${incoming} SELECT 1 FROM incoming i JOIN users u ON u.id=$2 WHERE i.started_at <= u.deleted_before LIMIT 1`,
    params,
  );
  if (cutoff.rowCount) throw new ContextConflict();
  // A batch must describe one immutable origin for each context session.
  const inconsistent = await client.query(
    `${incoming} SELECT session_id FROM incoming GROUP BY session_id HAVING count(DISTINCT (source,started_at))>1 LIMIT 1`,
    [params[0]],
  );
  if (inconsistent.rowCount) throw new ContextConflict();
  await client.query(
    `${incoming} INSERT INTO context_sessions(id,user_id,source,started_at) SELECT DISTINCT session_id,$2::uuid,source,started_at FROM incoming ON CONFLICT DO NOTHING`,
    params,
  );
  const mismatch = await client.query(
    `${incoming} SELECT 1 FROM incoming i LEFT JOIN context_sessions s ON s.id=i.session_id AND s.user_id=$2 AND s.source=i.source AND s.started_at=i.started_at WHERE s.id IS NULL LIMIT 1`,
    params,
  );
  if (mismatch.rowCount) throw new ContextConflict();
  const conflicts = await client.query(
    `${incoming} SELECT 1 FROM incoming i JOIN context_intervals c ON c.id=i.id WHERE c.user_id<>$2 OR c.payload<>i.payload
    UNION ALL SELECT 1 FROM incoming i JOIN context_intervals c ON c.user_id=$2 AND c.session_id=i.session_id AND c.id<>i.id AND c.start_time<i.end_time AND c.end_time>i.start_time
    UNION ALL SELECT 1 FROM incoming i JOIN incoming j ON i.session_id=j.session_id AND i.id::text<j.id::text AND i.start_time<j.end_time AND i.end_time>j.start_time LIMIT 1`,
    params,
  );
  if (conflicts.rowCount) throw new ContextConflict();
  const result = await client.query(
    `${incoming} INSERT INTO context_intervals(id,user_id,session_id,source,start_time,end_time,payload) SELECT id,$2,session_id,source,start_time,end_time,payload FROM incoming ON CONFLICT DO NOTHING`,
    params,
  );
  // Cross-owner requests do not share a lock. Recheck after ON CONFLICT waits
  // for a competing global ID so it cannot be acknowledged as our duplicate.
  const raced = await client.query(
    `${incoming} SELECT 1 FROM incoming i JOIN context_intervals c ON c.id=i.id WHERE c.user_id<>$2 OR c.payload<>i.payload LIMIT 1`,
    params,
  );
  if (raced.rowCount) throw new ContextConflict();
  const accepted = result.rowCount ?? 0;
  return { accepted, duplicates: intervals.length - accepted };
}
export async function exportContext(
  pool: Pool,
  userId: string,
  cursor?: string,
) {
  const parts = cursor
    ? contextCursorSchema.parse(cursor).split('|')
    : undefined;
  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM context_intervals WHERE user_id=$1 ${parts ? 'AND (start_time,id)>($2::timestamptz,$3::uuid)' : ''} ORDER BY start_time,id LIMIT 501`,
    parts ? [userId, ...parts] : [userId],
  );
  const intervals = result.rows
    .slice(0, 500)
    .map((row) => contextIntervalSchema.parse(row.payload));
  const last = intervals.at(-1);
  return {
    intervals,
    next: result.rows.length > 500 && last ? `${last.start}|${last.id}` : null,
  };
}
