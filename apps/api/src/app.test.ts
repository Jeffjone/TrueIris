import { describe, expect, it } from 'vitest';
import { healthSchema } from '@trueiris/schemas';
import { buildApp } from './app';

describe('API foundation', () => {
  it('returns validated liveness with honest integration states', async () => {
    const app = buildApp('silent');
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const health = healthSchema.parse(response.json());
      expect(Object.values(health.integrations)).toEqual([
        'not_implemented',
        'not_implemented',
        'not_implemented',
      ]);
      expect(response.body).not.toMatch(/apiKey|DATABASE_URL|password/);
    } finally {
      await app.close();
    }
  });
  it('does not accidentally expose unimplemented routes', async () => {
    const app = buildApp('silent');
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/measurements' })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
