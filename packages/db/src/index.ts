import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { calculateEpoch, epochStart, EPOCH_MS } from '@trueiris/analytics';
import {
  measurementBatchSchema,
  measurementSchema,
  exportCursorSchema,
  type Measurement,
  type RecordedActivity,
  type TimelineQuery,
  type TimelineData,
  type IngestionAck,
} from '@trueiris/schemas';
import { queryTimeline } from './timeline';
export { migrate } from './migration';

/** Strip URL SSL switches so they cannot override strict TLS options in pg. */
export function databaseOptions(
  connectionString: string,
  caFile?: string,
): PoolConfig {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const requestedTls =
    url.searchParams.has('sslmode') &&
    url.searchParams.get('sslmode') !== 'disable';
  for (const key of [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'sslnegotiation',
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max: 5,
    // Remote TLS/authentication can exceed the UI health request deadline.
    // Keep establishment bounded while allowing the pool to become ready.
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5000,
    ssl:
      local && !caFile && !requestedTls
        ? false
        : {
            rejectUnauthorized: true,
            ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}),
          },
  };
}
export class SessionConflict extends Error {}

interface MeasurementRow {
  timestamp: Date;
  event_id: string;
  session_id: string;
  source: Measurement['source'];
  started_at: Date;
  pulse_rate: number | null;
  pulse_confidence: number | null;
  breathing_rate: number | null;
  breathing_confidence: number | null;
  hrv_rmssd: number | null;
  hrv_confidence: number | null;
  talking: boolean | null;
  activity: RecordedActivity | null;
  signal_quality: Measurement['signalQuality'];
}
export function deserializeMeasurement(row: MeasurementRow): Measurement {
  return measurementSchema.parse({
    ...(row.activity != null ? { activity: row.activity } : {}),
    timestamp: row.timestamp.toISOString(),
    eventId: row.event_id,
    sessionId: row.session_id,
    source: row.source,
    startedAt: row.started_at.toISOString(),
    ...(row.pulse_rate !== null ? { pulseRate: row.pulse_rate } : {}),
    ...(row.pulse_confidence !== null
      ? { pulseConfidence: row.pulse_confidence }
      : {}),
    ...(row.breathing_rate !== null
      ? { respirationRate: row.breathing_rate }
      : {}),
    ...(row.breathing_confidence !== null
      ? { respirationConfidence: row.breathing_confidence }
      : {}),
    ...(row.hrv_rmssd !== null ? { hrvRmssd: row.hrv_rmssd } : {}),
    ...(row.hrv_confidence !== null
      ? { hrvConfidence: row.hrv_confidence }
      : {}),
    ...(row.talking !== null ? { talking: row.talking } : {}),
    signalQuality: row.signal_quality,
  });
}
const selectMeasurements = `SELECT m.*, s.started_at FROM measurements m JOIN sessions s ON s.id = m.session_id`;

export interface MeasurementStore {
  health(): Promise<boolean>;
  timeline(userId: string, query: TimelineQuery): Promise<TimelineData>;
  ingest(userId: string, measurements: Measurement[]): Promise<IngestionAck>;
  exportPage(
    userId: string,
    cursor?: string,
  ): Promise<{ measurements: Measurement[]; next: string | null }>;
  deleteData(userId: string): Promise<void>;
  close(): Promise<void>;
}
export class TigerStore implements MeasurementStore {
  readonly pool: Pool;
  constructor(connectionString: string, caFile?: string) {
    this.pool = new Pool(databaseOptions(connectionString, caFile));
    // Never emit database errors containing SQL, parameters or connection details.
    this.pool.on('error', () => {});
  }
  async health() {
    try {
      const result = await this.pool
        .query(`SELECT EXISTS (SELECT 1 FROM trueiris_migrations WHERE version = 2) AS ready,
        EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'measurements' AND hypertable_schema = 'public') AS hypertable`);
      return (
        result.rows[0]?.ready === true && result.rows[0]?.hypertable === true
      );
    } catch {
      return false;
    }
  }
  private async transaction<T>(
    userId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize a user's ingestion/deletion, including across API instances.
      await client.query(
        'INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING',
        [userId],
      );
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async ingest(userId: string, input: Measurement[]) {
    const { measurements } = measurementBatchSchema.parse({
      measurements: input,
    });
    return this.transaction(userId, async (client) => {
      const owner = await client.query(
        'SELECT deleted_before FROM users WHERE id=$1',
        [userId],
      );
      const cutoff = owner.rows[0]?.deleted_before as Date | null;
      if (
        cutoff &&
        measurements.some((m) => Date.parse(m.startedAt) <= cutoff.getTime())
      )
        throw new SessionConflict('Session predates deletion');
      const sessions = new Map<string, Measurement>();
      for (const m of measurements)
        sessions.set(`${m.sessionId}:${m.source}:${m.startedAt}`, m);
      for (const m of sessions.values()) {
        await client.query(
          'INSERT INTO sessions (id,user_id,source,started_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [m.sessionId, userId, m.source, m.startedAt],
        );
        const session = await client.query(
          'SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND source=$3 AND started_at=$4',
          [m.sessionId, userId, m.source, m.startedAt],
        );
        if (!session.rowCount)
          throw new SessionConflict('Session ownership or provenance mismatch');
      }
      const inserted = await client.query<{
        timestamp: Date;
        session_id: string;
        source: Measurement['source'];
      }>(
        `INSERT INTO measurements
        (timestamp,event_id,user_id,session_id,source,pulse_rate,pulse_confidence,breathing_rate,breathing_confidence,hrv_rmssd,hrv_confidence,talking,signal_quality,activity)
        SELECT timestamp,"eventId",$2,"sessionId",source,"pulseRate","pulseConfidence","respirationRate","respirationConfidence","hrvRmssd","hrvConfidence",talking,"signalQuality",activity
        FROM jsonb_to_recordset($1::jsonb) AS x(timestamp timestamptz,"eventId" uuid,"sessionId" uuid,source text,"pulseRate" double precision,"pulseConfidence" double precision,"respirationRate" double precision,"respirationConfidence" double precision,"hrvRmssd" double precision,"hrvConfidence" double precision,talking boolean,"signalQuality" text,activity text)
        ON CONFLICT DO NOTHING RETURNING timestamp,session_id,source`,
        [JSON.stringify(measurements), userId],
      );
      const accepted = inserted.rowCount ?? 0;
      const windows = new Map<
        string,
        { timestamp: string; sessionId: string; source: Measurement['source'] }
      >();
      for (const row of inserted.rows) {
        const timestamp = row.timestamp.toISOString();
        windows.set(
          `${row.session_id}:${row.source}:${epochStart(timestamp)}`,
          { timestamp, sessionId: row.session_id, source: row.source },
        );
      }
      for (const m of windows.values()) {
        const start = epochStart(m.timestamp);
        const result = await client.query<MeasurementRow>(
          `${selectMeasurements} WHERE m.user_id=$1 AND m.session_id=$2 AND m.source=$3 AND m.timestamp >= $4 AND m.timestamp < $5 ORDER BY m.timestamp`,
          [
            userId,
            m.sessionId,
            m.source,
            new Date(start),
            new Date(start + EPOCH_MS),
          ],
        );
        const e = calculateEpoch(result.rows.map(deserializeMeasurement));
        await client.query(
          `INSERT INTO epochs (user_id,session_id,source,start_time,end_time,mean_pulse,mean_respiration,mean_hrv,pulse_variance,measurement_count,pulse_count,respiration_count,hrv_count,coverage,missing_seconds,quality_score)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (user_id,session_id,source,start_time) DO UPDATE SET
          mean_pulse=EXCLUDED.mean_pulse,mean_respiration=EXCLUDED.mean_respiration,mean_hrv=EXCLUDED.mean_hrv,pulse_variance=EXCLUDED.pulse_variance,
          measurement_count=EXCLUDED.measurement_count,pulse_count=EXCLUDED.pulse_count,respiration_count=EXCLUDED.respiration_count,hrv_count=EXCLUDED.hrv_count,
          coverage=EXCLUDED.coverage,missing_seconds=EXCLUDED.missing_seconds,quality_score=EXCLUDED.quality_score`,
          [
            userId,
            e.sessionId,
            e.source,
            e.startTime,
            e.endTime,
            e.meanPulse,
            e.meanRespiration,
            e.meanHrv,
            e.pulseVariance,
            e.measurementCount,
            e.pulseCount,
            e.respirationCount,
            e.hrvCount,
            e.coverage,
            e.missingSeconds,
            e.qualityScore,
          ],
        );
      }
      return { accepted, duplicates: measurements.length - accepted };
    });
  }
  async timeline(userId: string, query: TimelineQuery) {
    return queryTimeline(this.pool, userId, query);
  }
  async exportPage(userId: string, cursor?: string) {
    const parts = cursor
      ? exportCursorSchema.parse(cursor).split('|')
      : undefined;
    const result = await this.pool.query<MeasurementRow>(
      `${selectMeasurements} WHERE m.user_id=$1 ${parts ? 'AND (m.timestamp,m.event_id) > ($2::timestamptz,$3::uuid)' : ''} ORDER BY m.timestamp,m.event_id LIMIT 501`,
      parts ? [userId, ...parts] : [userId],
    );
    const measurements = result.rows.slice(0, 500).map(deserializeMeasurement);
    const last = measurements.at(-1);
    return {
      measurements,
      next:
        result.rows.length > 500 && last
          ? `${last.timestamp}|${last.eventId}`
          : null,
    };
  }
  async deleteData(userId: string) {
    await this.transaction(userId, async (client) => {
      await client.query(
        "UPDATE users SET deleted_before=date_trunc('second',clock_timestamp()) WHERE id=$1",
        [userId],
      );
      await client.query('DELETE FROM epochs WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM measurements WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    });
  }
  async close() {
    await this.pool.end();
  }
}
