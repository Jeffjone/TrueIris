import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z.object({
  TRUEIRIS_API_URL: z
    .url()
    .refine(
      (value) =>
        URL.canParse(value) &&
        ['http:', 'https:'].includes(new URL(value).protocol),
      'Must use HTTP or HTTPS',
    )
    .default('http://127.0.0.1:3001'),
  TRUEIRIS_API_HOST: z.string().min(1).default('127.0.0.1'),
  TRUEIRIS_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TRUEIRIS_DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  VULTR_DEPLOYMENT_ENV: z
    .enum(['local', 'staging', 'production'])
    .default('local'),
  PRESAGE_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  ELEVENLABS_API_KEY: optionalSecret,
  ELEVENLABS_VOICE_ID: optionalSecret,
  DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) &&
          ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'Must use PostgreSQL',
      )
      .optional(),
  ),
});
export type Environment = z.infer<typeof envSchema>;

export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    // Never print input values or an entire environment object.
    throw new Error(
      `Invalid environment fields: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  }
  return result.data;
}

/** Find the repository root even when pnpm launches from a workspace directory. */
export function loadWorkspaceEnvironment(): void {
  let directory = process.cwd();
  for (;;) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      config({ path: join(directory, '.env'), quiet: true });
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
