import type { Pool } from 'pg';

// Versioned SQL stays bundled with the migration runner; runtime never creates tables.
export const schemaSql = `
CREATE TABLE users (id uuid PRIMARY KEY, deleted_before timestamptz);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  source text NOT NULL CHECK (source IN ('live','mock','demo_seed')),
  started_at timestamptz NOT NULL,
  UNIQUE (id, user_id, source)
);
CREATE INDEX sessions_user_time ON sessions (user_id, started_at DESC);
CREATE TABLE measurements (
  timestamp timestamptz NOT NULL, event_id uuid NOT NULL,
  user_id uuid NOT NULL, session_id uuid NOT NULL, source text NOT NULL,
  pulse_rate double precision CHECK (pulse_rate > 0),
  pulse_confidence double precision CHECK (pulse_confidence BETWEEN 0 AND 1),
  breathing_rate double precision CHECK (breathing_rate >= 0),
  breathing_confidence double precision CHECK (breathing_confidence BETWEEN 0 AND 1),
  hrv_rmssd double precision CHECK (hrv_rmssd >= 0),
  hrv_confidence double precision CHECK (hrv_confidence BETWEEN 0 AND 1),
  talking boolean,
  signal_quality text NOT NULL CHECK (signal_quality IN ('excellent','good','poor','unavailable')),
  PRIMARY KEY (timestamp, event_id),
  UNIQUE (user_id, session_id, timestamp),
  FOREIGN KEY (session_id,user_id,source) REFERENCES sessions(id,user_id,source)
);
CREATE INDEX measurements_user_time ON measurements (user_id, timestamp DESC);
CREATE INDEX measurements_session_time ON measurements (user_id, session_id, source, timestamp);
CREATE TABLE epochs (
  user_id uuid NOT NULL, session_id uuid NOT NULL, source text NOT NULL,
  start_time timestamptz NOT NULL, end_time timestamptz NOT NULL,
  mean_pulse double precision, mean_respiration double precision, mean_hrv double precision,
  pulse_variance double precision, measurement_count integer NOT NULL,
  pulse_count integer NOT NULL, respiration_count integer NOT NULL, hrv_count integer NOT NULL,
  coverage double precision NOT NULL, missing_seconds integer NOT NULL, quality_score double precision NOT NULL,
  activity text, context_event_id uuid,
  PRIMARY KEY (user_id,session_id,source,start_time),
  FOREIGN KEY (session_id,user_id,source) REFERENCES sessions(id,user_id,source)
);
CREATE INDEX epochs_user_time ON epochs (user_id, start_time DESC);
`;

export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72849100)');
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await client.query(
      'CREATE TABLE IF NOT EXISTS trueiris_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query(
      'SELECT version FROM trueiris_migrations WHERE version = 1',
    );
    if (!applied.rowCount) {
      await client.query(schemaSql);
      await client.query(
        "SELECT create_hypertable('measurements', by_range('timestamp', INTERVAL '1 day'))",
      );
      await client.query(
        'INSERT INTO trueiris_migrations (version) VALUES (1)',
      );
    }
    const timeline = await client.query(
      'SELECT version FROM trueiris_migrations WHERE version = 2',
    );
    if (!timeline.rowCount) {
      await client.query(
        "ALTER TABLE measurements ADD COLUMN activity text CHECK (activity IN ('Coding','Studying','Reading','Meeting','Break','Other'))",
      );
      await client.query(
        'CREATE INDEX measurements_user_source_time ON measurements (user_id,source,timestamp DESC)',
      );
      await client.query(
        'INSERT INTO trueiris_migrations (version) VALUES (2)',
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
