import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { TigerStore } from './index';
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.TRUEIRIS_DEMO_MODE)
  throw new Error('Demo seeding/clearing requires TRUEIRIS_DEMO_MODE=true');
if (!env.DATABASE_URL)
  throw new Error('Set DATABASE_URL in the ignored root .env');
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
try {
  if (!(await store.health()))
    throw new Error('Run pnpm db:migrate before demo seeding');
  if (process.argv.includes('--clear')) {
    await store.demo.clear(env.TRUEIRIS_DEMO_USER_ID);
    console.log(
      'Cleared only demo_seed history and derived artifacts for the dedicated demo identity; live/mock captures are preserved.',
    );
  } else {
    const data = await store.demo.seed(env.TRUEIRIS_DEMO_USER_ID);
    console.log(
      `Seeded ${data.measurementCount} illustrative readings, ${data.episodes.length} periods, sample summaries/patterns and a seven-session experiment. All generated history is demo_seed.`,
    );
  }
} catch {
  console.error(
    'Demo operation failed. Check demo mode, migration, database readiness and verified TLS; credentials are omitted.',
  );
  process.exitCode = 1;
} finally {
  await store.close();
}
