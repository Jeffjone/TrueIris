import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { migrate, TigerStore } from './index';
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL)
  throw new Error('Set DATABASE_URL in the ignored root .env');
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
try {
  await migrate(store.pool);
  console.log(
    'TrueIris migration 1 applied; measurements is a Timescale hypertable.',
  );
} catch {
  console.error(
    'Migration failed. Check connection, TLS certificate, and Timescale extension permissions.',
  );
  process.exitCode = 1;
} finally {
  await store.close();
}
