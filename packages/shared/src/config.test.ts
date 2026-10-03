import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './config';

describe('environment validation', () => {
  it('starts without sponsor credentials and treats demo=false as false', () => {
    const env = parseEnvironment({
      TRUEIRIS_DEMO_MODE: 'false',
      PRESAGE_API_KEY: '',
      DATABASE_URL: '',
    });
    expect(env.TRUEIRIS_DEMO_MODE).toBe(false);
    expect(env.PRESAGE_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.TRUEIRIS_API_PORT).toBe(3001);
  });
  it.each([
    { TRUEIRIS_API_PORT: '0' },
    { TRUEIRIS_API_PORT: '65536' },
    { TRUEIRIS_DEMO_MODE: 'yes' },
    { TRUEIRIS_API_URL: 'file:///tmp/test' },
    { DATABASE_URL: 'https://secret@example.com' },
  ])('rejects invalid configuration %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow(
      'Invalid environment fields:',
    );
  });
  it('reports field names without leaking a malformed secret value', () => {
    expect(() =>
      parseEnvironment({ DATABASE_URL: 'private-password' }),
    ).toThrow('Invalid environment fields: DATABASE_URL');
  });
  it('parses explicit demo mode and a PostgreSQL URL', () => {
    const env = parseEnvironment({
      TRUEIRIS_DEMO_MODE: 'true',
      DATABASE_URL: 'postgresql://localhost/trueiris',
    });
    expect(env.TRUEIRIS_DEMO_MODE).toBe(true);
    expect(env.DATABASE_URL).toBe('postgresql://localhost/trueiris');
  });
});
