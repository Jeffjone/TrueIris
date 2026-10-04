import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { compareExperiment } from '@trueiris/analytics';
import {
  experimentSchema,
  experimentDefinitionSchema,
  experimentRecordSchema,
  experimentSessionSchema,
  experimentDetailSchema,
  baselineDataSchema,
  baselineQuerySchema,
  timelineDataSchema,
  type Experiment,
  type ExperimentDefinition,
  type ExperimentRecord,
  type ExperimentDetail,
  type ExperimentSession,
} from '@trueiris/schemas';
import type { MeasurementStore } from './index';
export class ExperimentConflict extends Error {
  constructor() {
    super('Experiment conflicts with its definition or saved sessions');
  }
}
export class ExperimentNotFound extends Error {
  constructor() {
    super('Experiment is unavailable');
  }
}
export interface ExperimentStore {
  list(userId: string): Promise<Experiment[]>;
  create(userId: string, definition: ExperimentDefinition): Promise<Experiment>;
  get(userId: string, id: string): Promise<ExperimentDetail>;
  status(
    userId: string,
    id: string,
    status: Experiment['status'],
  ): Promise<Experiment>;
  record(
    userId: string,
    id: string,
    input: ExperimentRecord,
  ): Promise<ExperimentDetail>;
  remove(userId: string, id: string): Promise<void>;
  removeSession(
    userId: string,
    id: string,
    sessionId: string,
  ): Promise<ExperimentDetail>;
}
type History = Pick<MeasurementStore, 'timeline' | 'baselines'>;
function detail(experiment: Experiment, sessions: ExperimentSession[]) {
  return experimentDetailSchema.parse({
    experiment,
    sessions,
    comparisons: compareExperiment(experiment, sessions),
  });
}
function checkRecord(experiment: Experiment, input: ExperimentRecord) {
  if (
    experiment.status !== 'active' ||
    input.range.source !== experiment.definition.source ||
    !experiment.definition.conditions.includes(input.condition) ||
    Date.parse(input.range.end) > Date.now()
  )
    throw new ExperimentConflict();
}
function duplicate(sessions: ExperimentSession[], input: ExperimentRecord) {
  const overlap = sessions.find(
    (s) =>
      s.input.range.start < input.range.end &&
      s.input.range.end > input.range.start,
  );
  if (overlap && JSON.stringify(overlap.input) !== JSON.stringify(input))
    throw new ExperimentConflict();
  if (!overlap && sessions.length >= 200) throw new ExperimentConflict();
  return overlap;
}
async function measuredSession(
  userId: string,
  experiment: Experiment,
  input: ExperimentRecord,
  history: History,
): Promise<ExperimentSession> {
  const query = baselineQuerySchema.parse({
    range: input.range,
    timezone: experiment.definition.timezone,
    context: {
      kind: 'activity' as const,
      activity: experiment.definition.activity,
    },
    lookbackDays: 30,
  });
  const [rawTimeline, rawBaseline] = await Promise.all([
    history.timeline(userId, input.range),
    history.baselines(userId, query),
  ]);
  const data = timelineDataSchema.parse(rawTimeline),
    baseline = baselineDataSchema.parse(rawBaseline);
  if (
    JSON.stringify(data.range) !== JSON.stringify(input.range) ||
    JSON.stringify(baseline.query) !== JSON.stringify(query)
  )
    throw new ExperimentConflict();
  const seconds =
    (Date.parse(input.range.end) - Date.parse(input.range.start)) / 1000;
  const pulse = baseline.comparisons[0],
    hrv = baseline.comparisons[2];
  const deviation = (c: typeof pulse) =>
    c.state === 'ready' &&
    c.currentCount >= 20 &&
    c.currentCount / seconds >= 0.5
      ? c.differencePercent
      : null;
  return experimentSessionSchema.parse({
    id: randomUUID(),
    experimentId: experiment.id,
    recordedAt: new Date().toISOString(),
    input,
    metrics: {
      session_duration: seconds / 60,
      focus_rating: input.rating,
      pulse_deviation: deviation(pulse),
      hrv_deviation: deviation(hrv),
    },
    evidence: {
      retrospective: input.range.start < experiment.createdAt,
      observedSeconds: data.summary.observedSeconds,
      expectedSeconds: seconds,
      pulse,
      hrv,
    },
  });
}
type ExperimentRow = {
  id: string;
  created_at: Date;
  status: Experiment['status'];
  definition: ExperimentDefinition;
};
const decode = (r: ExperimentRow) =>
  experimentSchema.parse({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    status: r.status,
    definition: r.definition,
  });
type SessionRow = {
  id: string;
  experiment_id: string;
  condition: string;
  source: ExperimentDefinition['source'];
  start_time: Date;
  end_time: Date;
  recorded_at: Date;
  user_rating: number | null;
  notes: string | null;
  metrics_json: Pick<ExperimentSession, 'metrics' | 'evidence'>;
};
const decodeSession = (r: SessionRow) =>
  experimentSessionSchema.parse({
    id: r.id,
    experimentId: r.experiment_id,
    recordedAt: r.recorded_at.toISOString(),
    input: {
      condition: r.condition,
      range: {
        source: r.source,
        start: r.start_time.toISOString(),
        end: r.end_time.toISOString(),
      },
      rating: r.user_rating,
      notes: r.notes,
    },
    ...r.metrics_json,
  });
export class TigerExperiments implements ExperimentStore {
  constructor(
    private readonly pool: Pool,
    private readonly history: (client: PoolClient) => History,
    private readonly transaction: <T>(
      userId: string,
      work: (client: PoolClient) => Promise<T>,
    ) => Promise<T>,
  ) {}
  async list(userId: string) {
    const result = await this.pool.query<ExperimentRow>(
      'SELECT * FROM experiments WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 50',
      [userId],
    );
    return result.rows.map(decode);
  }
  async create(userId: string, input: ExperimentDefinition) {
    const definition = experimentDefinitionSchema.parse(input);
    const acceptedAt = Date.now();
    return this.transaction(userId, async (client) => {
      const owner = await client.query(
        'SELECT deleted_before FROM users WHERE id=$1',
        [userId],
      );
      if (
        owner.rows[0]?.deleted_before &&
        acceptedAt <= owner.rows[0].deleted_before.getTime()
      )
        throw new ExperimentConflict();
      const count = await client.query(
        'SELECT count(*)::int AS n FROM experiments WHERE user_id=$1',
        [userId],
      );
      if (count.rows[0].n >= 50) throw new ExperimentConflict();
      const result = await client.query<ExperimentRow>(
        "INSERT INTO experiments(id,user_id,source,title,hypothesis,metric_definition,definition,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',clock_timestamp()) RETURNING *",
        [
          randomUUID(),
          userId,
          definition.source,
          definition.title,
          definition.hypothesis,
          JSON.stringify(definition.criteria),
          JSON.stringify(definition),
        ],
      );
      return decode(result.rows[0]!);
    });
  }
  async get(userId: string, id: string) {
    const result = await this.pool.query<ExperimentRow>(
      'SELECT * FROM experiments WHERE id=$1 AND user_id=$2',
      [id, userId],
    );
    if (!result.rowCount) throw new ExperimentNotFound();
    const rows = await this.pool.query<SessionRow>(
      'SELECT * FROM experiment_sessions WHERE experiment_id=$1 AND user_id=$2 ORDER BY start_time,id LIMIT 200',
      [id, userId],
    );
    return detail(decode(result.rows[0]!), rows.rows.map(decodeSession));
  }
  async status(userId: string, id: string, status: Experiment['status']) {
    return this.transaction(userId, async (client) => {
      const result = await client.query<ExperimentRow>(
        'UPDATE experiments SET status=$3 WHERE id=$1 AND user_id=$2 RETURNING *',
        [id, userId, status],
      );
      if (!result.rowCount) throw new ExperimentNotFound();
      return decode(result.rows[0]!);
    });
  }
  async record(userId: string, id: string, raw: ExperimentRecord) {
    const input = experimentRecordSchema.parse(raw);
    return this.transaction(userId, async (client) => {
      const result = await client.query<ExperimentRow>(
        'SELECT * FROM experiments WHERE id=$1 AND user_id=$2',
        [id, userId],
      );
      if (!result.rowCount) throw new ExperimentNotFound();
      const experiment = decode(result.rows[0]!);
      checkRecord(experiment, input);
      const cutoff = await client.query(
        'SELECT deleted_before FROM users WHERE id=$1',
        [userId],
      );
      if (
        cutoff.rows[0]?.deleted_before &&
        Date.parse(input.range.start) <= cutoff.rows[0].deleted_before.getTime()
      )
        throw new ExperimentConflict();
      const rows = await client.query<SessionRow>(
        'SELECT * FROM experiment_sessions WHERE experiment_id=$1 AND user_id=$2 ORDER BY start_time,id',
        [id, userId],
      );
      const sessions = rows.rows.map(decodeSession);
      if (duplicate(sessions, input)) return detail(experiment, sessions);
      const session = await measuredSession(
        userId,
        experiment,
        input,
        this.history(client),
      );
      await client.query(
        'INSERT INTO experiment_sessions(id,user_id,experiment_id,condition,start_time,end_time,source,metrics_json,user_rating,notes,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          session.id,
          userId,
          id,
          input.condition,
          input.range.start,
          input.range.end,
          input.range.source,
          JSON.stringify({
            metrics: session.metrics,
            evidence: session.evidence,
          }),
          input.rating,
          input.notes,
          session.recordedAt,
        ],
      );
      return detail(
        experiment,
        [...sessions, session].sort((a, b) =>
          a.input.range.start.localeCompare(b.input.range.start),
        ),
      );
    });
  }
  async remove(userId: string, id: string) {
    await this.transaction(userId, async (client) => {
      const result = await client.query(
        'DELETE FROM experiments WHERE user_id=$1 AND id=$2',
        [userId, id],
      );
      if (!result.rowCount) throw new ExperimentNotFound();
    });
  }
  async removeSession(userId: string, id: string, sessionId: string) {
    await this.transaction(userId, async (client) => {
      const result = await client.query(
        'DELETE FROM experiment_sessions WHERE user_id=$1 AND experiment_id=$2 AND id=$3',
        [userId, id, sessionId],
      );
      if (!result.rowCount) throw new ExperimentNotFound();
    });
    return this.get(userId, id);
  }
}
/** Explicit test storage, never enabled by a production fallback. Uses the same metric/comparison rules. */
export class MemoryExperiments implements ExperimentStore {
  private pending: Promise<void> = Promise.resolve();
  private write<T>(work: () => Promise<T>) {
    const result = this.pending.then(work);
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  create(userId: string, raw: ExperimentDefinition) {
    return this.write(() => this.createRecord(userId, raw));
  }
  status(userId: string, id: string, status: Experiment['status']) {
    return this.write(() => this.changeStatus(userId, id, status));
  }
  record(userId: string, id: string, input: ExperimentRecord) {
    return this.write(() => this.recordSession(userId, id, input));
  }
  remove(userId: string, id: string) {
    return this.write(() => this.removeRecord(userId, id));
  }
  removeSession(userId: string, id: string, sessionId: string) {
    return this.write(() => this.removeSessionRecord(userId, id, sessionId));
  }
  private records = new Map<string, ExperimentDetail>();
  constructor(private readonly history: History) {}
  async list(userId: string) {
    return [...this.records]
      .filter(([key]) => key.startsWith(userId + ':'))
      .map(([, d]) => d.experiment);
  }
  private async createRecord(userId: string, raw: ExperimentDefinition) {
    if ((await this.list(userId)).length >= 50) throw new ExperimentConflict();
    const experiment = experimentSchema.parse({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'active',
      definition: experimentDefinitionSchema.parse(raw),
    });
    this.records.set(userId + ':' + experiment.id, detail(experiment, []));
    return experiment;
  }
  async get(userId: string, id: string) {
    const value = this.records.get(userId + ':' + id);
    if (!value) throw new ExperimentNotFound();
    return structuredClone(value);
  }
  private async changeStatus(
    userId: string,
    id: string,
    status: Experiment['status'],
  ) {
    const d = await this.get(userId, id);
    d.experiment.status = status;
    this.records.set(userId + ':' + id, d);
    return d.experiment;
  }
  private async recordSession(
    userId: string,
    id: string,
    input: ExperimentRecord,
  ) {
    input = experimentRecordSchema.parse(input);
    const d = await this.get(userId, id);
    checkRecord(d.experiment, input);
    if (!duplicate(d.sessions, input))
      d.sessions.push(
        await measuredSession(userId, d.experiment, input, this.history),
      );
    const next = detail(
      d.experiment,
      d.sessions.sort((a, b) =>
        a.input.range.start.localeCompare(b.input.range.start),
      ),
    );
    this.records.set(userId + ':' + id, next);
    return next;
  }
  private async removeRecord(userId: string, id: string) {
    await this.get(userId, id);
    this.records.delete(userId + ':' + id);
  }
  private async removeSessionRecord(
    userId: string,
    id: string,
    sessionId: string,
  ) {
    const d = await this.get(userId, id);
    const sessions = d.sessions.filter((s) => s.id !== sessionId);
    if (sessions.length === d.sessions.length) throw new ExperimentNotFound();
    const next = detail(d.experiment, sessions);
    this.records.set(userId + ':' + id, next);
    return next;
  }
}
