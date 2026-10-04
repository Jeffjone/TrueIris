import { randomUUID } from 'node:crypto';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { runAgent } from './agent';
import {
  GeminiReasoningProvider,
  ProviderError,
  type ReasoningProvider,
} from './provider';
import { createReasoningFixture, fixtureRequest } from './fixtures';

loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.GEMINI_API_KEY)
  throw new Error('Configure GEMINI_API_KEY in the ignored root .env');
const actual = new GeminiReasoningProvider(
  env.GEMINI_API_KEY,
  env.GEMINI_MODEL,
);
let turns = 0,
  providerStatus: number | undefined;
const provider: ReasoningProvider = {
  kind: 'gemini',
  configured: true,
  next: async (contents, signal) => {
    turns++;
    try {
      return await actual.next(contents, signal);
    } catch (error) {
      if (error instanceof ProviderError) providerStatus = error.status;
      throw error;
    }
  },
};
const { store } = createReasoningFixture();
const result = await runAgent({
  request: fixtureRequest,
  provider,
  store,
  userId: randomUUID(),
  signal: AbortSignal.timeout(60_000),
});
const passed = Boolean(
  result.data &&
  result.data.provider === 'gemini' &&
  result.data.evidence.length >= 2 &&
  !result.data.answer.startsWith('Iris could not finish') &&
  result.data.selectedFacts.every((f) =>
    result.data!.evidence.some((e) =>
      e.facts.some((x) => x.id === f.id && x.text === f.text),
    ),
  ),
);
console.log(
  JSON.stringify({
    check: 'live_gemini_synthetic_fixture',
    passed,
    state: result.state,
    evidenceStates: result.data?.evidence.map((e) => e.status) ?? [],
    turns,
    tools: result.data?.evidence.map((e) => e.tool) ?? [],
    ...(providerStatus ? { providerHttpStatus: providerStatus } : {}),
  }),
);
if (!passed) process.exitCode = 1;
