import type { Pool, PoolClient } from 'pg';
import {
  demoDatasetSchema,
  experimentSchema,
  type DemoDataset,
} from '@trueiris/schemas';
import { generateDemo, demoId } from './demo-generator';
import { measuredSession } from './experiments';
import { queryBaselines } from './baseline';
import { queryTimelineInTransaction } from './timeline';
export interface DemoStore {
  get(userId: string): Promise<DemoDataset | null>;
  seed(userId: string, now?: Date): Promise<DemoDataset>;
  clear(userId: string): Promise<void>;
}
/** Synthetic records only; all SQL binds both owner and demo_seed source. */
export class TigerDemo implements DemoStore {
  constructor(
    private readonly pool: Pool,
    private readonly transaction: <T>(
      owner: string,
      work: (client: PoolClient) => Promise<T>,
    ) => Promise<T>,
  ) {}
  async get(userId: string) {
    const result = await this.pool.query(
      "SELECT data FROM demo_datasets WHERE user_id=$1 AND source='demo_seed'",
      [userId],
    );
    return result.rowCount
      ? demoDatasetSchema.parse(result.rows[0].data)
      : null;
  }
  async seed(userId: string, now = new Date()) {
    const generated = generateDemo(userId, now);
    return this.transaction(userId, async (client) => {
      const previous = await client.query(
        "SELECT data FROM demo_datasets WHERE user_id=$1 AND source='demo_seed'",
        [userId],
      );
      if (previous.rowCount) {
        const old = demoDatasetSchema.parse(previous.rows[0].data);
        if (old.generatedAt === generated.dataset.generatedAt) return old;
        // Refresh only records managed by the prior manifest, preserving captures
        // and independently created experiments, including other seeded sessions.
        const ids = old.episodes.map((e) => e.id);
        await client.query(
          "DELETE FROM experiments WHERE user_id=$1 AND source='demo_seed' AND id=ANY($2::uuid[])",
          [userId, old.experimentIds],
        );
        for (const table of ['epochs', 'measurements', 'context_intervals'])
          await client.query(
            `DELETE FROM ${table} WHERE user_id=$1 AND source='demo_seed' AND session_id=ANY($2::uuid[])`,
            [userId, ids],
          );
        for (const table of ['sessions', 'context_sessions'])
          await client.query(
            `DELETE FROM ${table} WHERE user_id=$1 AND source='demo_seed' AND id=ANY($2::uuid[])`,
            [userId, ids],
          );
      }
      const {
        dataset,
        measurements,
        contexts,
        epochs,
        experimentId,
        definition,
      } = generated;
      const sessions = dataset.episodes.map((e) => ({
        id: e.id,
        start: e.range.start,
      }));
      for (const table of ['sessions', 'context_sessions'])
        await client.query(
          `INSERT INTO ${table}(id,user_id,source,started_at) SELECT id,$2,'demo_seed',start FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,start timestamptz)`,
          [JSON.stringify(sessions), userId],
        );
      for (let offset = 0; offset < measurements.length; offset += 2000)
        await client.query(
          `INSERT INTO measurements(timestamp,event_id,user_id,session_id,source,pulse_rate,pulse_confidence,breathing_rate,breathing_confidence,hrv_rmssd,hrv_confidence,talking,signal_quality,activity)
        SELECT timestamp,"eventId",$2,"sessionId",'demo_seed',"pulseRate","pulseConfidence","respirationRate","respirationConfidence","hrvRmssd","hrvConfidence",talking,"signalQuality",activity
        FROM jsonb_to_recordset($1::jsonb) AS x(timestamp timestamptz,"eventId" uuid,"sessionId" uuid,"pulseRate" float8,"pulseConfidence" float8,"respirationRate" float8,"respirationConfidence" float8,"hrvRmssd" float8,"hrvConfidence" float8,talking boolean,"signalQuality" text,activity text)`,
          [JSON.stringify(measurements.slice(offset, offset + 2000)), userId],
        );
      await client.query(
        `INSERT INTO context_intervals(id,user_id,session_id,source,start_time,end_time,payload)
        SELECT (value->>'id')::uuid,$2,(value->>'sessionId')::uuid,'demo_seed',(value->>'start')::timestamptz,(value->>'end')::timestamptz,value FROM jsonb_array_elements($1::jsonb)`,
        [JSON.stringify(contexts), userId],
      );
      await client.query(
        `INSERT INTO epochs(user_id,session_id,source,start_time,end_time,mean_pulse,mean_respiration,mean_hrv,pulse_variance,measurement_count,pulse_count,respiration_count,hrv_count,coverage,missing_seconds,quality_score)
        SELECT $2,"sessionId",'demo_seed',"startTime","endTime","meanPulse","meanRespiration","meanHrv","pulseVariance","measurementCount","pulseCount","respirationCount","hrvCount",coverage,"missingSeconds","qualityScore"
        FROM jsonb_to_recordset($1::jsonb) AS x("sessionId" uuid,"startTime" timestamptz,"endTime" timestamptz,"meanPulse" float8,"meanRespiration" float8,"meanHrv" float8,"pulseVariance" float8,"measurementCount" int,"pulseCount" int,"respirationCount" int,"hrvCount" int,coverage float8,"missingSeconds" int,"qualityScore" float8)`,
        [JSON.stringify(epochs), userId],
      );
      await client.query(
        `INSERT INTO experiments(id,user_id,source,title,hypothesis,metric_definition,definition,status,created_at) VALUES($1,$2,'demo_seed',$3,$4,$5,$6,'active',$7)`,
        [
          experimentId,
          userId,
          definition.title,
          definition.hypothesis,
          JSON.stringify(definition.criteria),
          JSON.stringify(definition),
          dataset.generatedAt,
        ],
      );
      const experiment = experimentSchema.parse({
        id: experimentId,
        createdAt: dataset.generatedAt,
        status: 'active',
        definition,
      });
      const history = {
        timeline: (
          owner: string,
          range: Parameters<typeof queryTimelineInTransaction>[2],
        ) => queryTimelineInTransaction(client, owner, range),
        baselines: (
          owner: string,
          query: Parameters<typeof queryBaselines>[2],
        ) => queryBaselines(client, owner, query),
      };
      for (const [index, input] of generated.experimentRecords.entries()) {
        const session = await measuredSession(
          userId,
          experiment,
          input,
          history,
        );
        await client.query(
          `INSERT INTO experiment_sessions(id,user_id,experiment_id,source,condition,start_time,end_time,metrics_json,user_rating,notes,recorded_at) VALUES($1,$2,$3,'demo_seed',$4,$5,$6,$7,$8,$9,$10)`,
          [
            demoId(
              userId,
              `experiment-session:${index}:${dataset.generatedAt}`,
            ),
            userId,
            experimentId,
            input.condition,
            input.range.start,
            input.range.end,
            JSON.stringify({
              metrics: session.metrics,
              evidence: session.evidence,
            }),
            input.rating,
            input.notes,
            session.recordedAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO demo_datasets(user_id,source,data) VALUES($1,'demo_seed',$2) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data`,
        [userId, JSON.stringify(dataset)],
      );
      return dataset;
    });
  }
  async clear(userId: string) {
    await this.transaction(userId, async (client) => {
      await client.query(
        "DELETE FROM experiments WHERE user_id=$1 AND source='demo_seed'",
        [userId],
      );
      for (const table of [
        'epochs',
        'measurements',
        'context_intervals',
        'sessions',
        'context_sessions',
        'demo_datasets',
      ])
        await client.query(
          `DELETE FROM ${table} WHERE user_id=$1 AND source='demo_seed'`,
          [userId],
        );
    });
  }
}
