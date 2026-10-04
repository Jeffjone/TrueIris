import { describe, expect, it } from 'vitest';
import { databaseOptions, deserializeMeasurement } from './index';
describe('Tiger Data boundaries', () => {
  it('enforces verified TLS remotely even when the connection string says disable or no-verify', () => {
    for (const mode of ['disable', 'no-verify', 'require']) {
      const options = databaseOptions(
        `postgresql://user:password@example.com/db?sslmode=${mode}`,
      );
      expect(options.ssl).toEqual({ rejectUnauthorized: true });
      expect(options.connectionString).not.toContain('sslmode');
    }
    expect(databaseOptions('postgresql://localhost/db').ssl).toBe(false);
  });
  it('deserializes UTC and SQL NULL without inventing metrics', () => {
    const row = deserializeMeasurement({
      timestamp: new Date('2026-10-03T12:00:00Z'),
      started_at: new Date('2026-10-03T12:00:00Z'),
      event_id: '00000000-0000-4000-8000-000000000001',
      session_id: '00000000-0000-4000-8000-000000000002',
      source: 'live',
      pulse_rate: 74,
      pulse_confidence: 0.8,
      breathing_rate: null,
      breathing_confidence: null,
      hrv_rmssd: null,
      hrv_confidence: null,
      talking: null,
      signal_quality: 'good',
      activity: null,
    });
    expect(row.timestamp).toBe('2026-10-03T12:00:00.000Z');
    expect(row).not.toHaveProperty('respirationRate');
    expect(row).not.toHaveProperty('talking');
  });
});
