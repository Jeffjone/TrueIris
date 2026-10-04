import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { TigerStore } from '@trueiris/db';
import { agentResultSchema } from '@trueiris/schemas';
import { buildApp } from './app';
import { GeminiReasoningProvider } from './agents/provider';
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL || !env.GEMINI_API_KEY)
  throw new Error(
    'Configure DATABASE_URL and GEMINI_API_KEY in the ignored root .env',
  );
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE),
  owner = randomUUID(),
  token = randomUUID() + randomUUID();
const api = buildApp('silent', {
  store,
  userId: owner,
  token,
  demoMode: true,
  reasoning: new GeminiReasoningProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL),
});
try {
  await api.ready();
  const prepare = await api.inject({
    method: 'POST',
    url: '/demo/prepare',
    headers: { authorization: `Bearer ${token}`, 'x-trueiris-mode': 'demo' },
    payload: {},
  });
  assert.equal(prepare.json().state, 'ready');
  for (const question of [
    'Iris, explain the last 30 minutes.',
    'Summarize today’s sample history and compare its coding pulse with the earlier coding baseline.',
    'Find sample coding episode summaries from history.',
  ]) {
    const response = await api.inject({
      method: 'POST',
      url: '/agent/ask',
      headers: { authorization: `Bearer ${token}`, 'x-trueiris-mode': 'demo' },
      payload: {
        question,
        source: 'demo_seed',
        timezone: 'UTC',
        current: {
          sensor: 'off',
          reading: null,
          context: 'off',
          contextSource: 'live',
          application: null,
          activity: null,
          saving: false,
        },
      },
    });
    const result = agentResultSchema.parse(response.json());
    assert.ok(
      result.data &&
        result.data.provider === 'gemini' &&
        result.data.query.source === 'demo_seed' &&
        !result.data.answer.startsWith('Iris could not finish'),
    );
    assert.ok(result.data.selectedFacts.length > 0);
    assert.ok(
      result.data.evidence.every((e) =>
        e.facts.every((f) => !f.range || f.range.source === 'demo_seed'),
      ),
    );
    if (question.includes('summaries'))
      assert.ok(
        result.data.evidence.some(
          (e) => e.tool === 'search_memories' && e.status === 'ready',
        ),
      );
    console.log(
      `Live demo question verified: ${result.state}; ${result.data.evidence.length} scoped tool results; cited facts only.`,
    );
  }
} catch {
  console.error(
    'Live demo verification failed; no provider bodies, credentials, transcripts or database records displayed.',
  );
  process.exitCode = 1;
} finally {
  await store.deleteData(owner);
  await store.pool.query('DELETE FROM users WHERE id=$1', [owner]);
  await api.close();
}
