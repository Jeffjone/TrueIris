import {
  INCOMPLETE_ANSWER_PREFIX,
  askRequestSchema,
  agentResultSchema,
  evidenceSchema,
  respondSchema,
  type AgentEvidence,
  type AgentResult,
  type AskRequest,
  type EvidenceFact,
} from '@trueiris/schemas';
import type { MeasurementStore } from '@trueiris/db';
import { executeTool, toolSchemas, type ToolName } from './tools';
import {
  modelContentSchema,
  type ConversationContent,
  type ReasoningProvider,
} from './provider';

async function withSignal<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    signal.throwIfAborted();
  }
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function assembleAnswer(
  request: AskRequest,
  provider: ReasoningProvider,
  asOf: string,
  evidence: AgentEvidence[],
  ids: string[],
  incomplete = false,
): AgentResult {
  if (!evidence.length) return { state: 'unavailable', data: null };
  const facts = new Map(evidence.flatMap((e) => e.facts).map((f) => [f.id, f]));
  const selected = ids.map((id) => facts.get(id));
  if (selected.some((f) => !f)) throw new Error('Unknown evidence citation');
  // Preserve missing/limited evidence even if the model omits it.
  const limitations = evidence.flatMap((e) =>
    e.limitations.map((id) => facts.get(id)!),
  );
  const required = [
    ...new Map(limitations.map((f) => [f.id, f])).values(),
  ].slice(0, 12);
  const requiredIds = new Set(required.map((f) => f.id));
  const selectedFacts = [
    ...new Map(
      (selected as EvidenceFact[])
        .filter((f) => !requiredIds.has(f.id))
        .map((f) => [f.id, f]),
    ).values(),
  ]
    .slice(0, 12 - required.length)
    .concat(required);
  if (!selectedFacts.length) selectedFacts.push(evidence[0]!.facts[0]!);
  const { current: _current, ...query } = request;
  void _current;
  return agentResultSchema.parse({
    state:
      incomplete || evidence.some((e) => e.status !== 'ready')
        ? 'partial'
        : 'ready',
    data: {
      query,
      provider: provider.kind,
      asOf,
      answer:
        (incomplete ? INCOMPLETE_ANSWER_PREFIX : '') +
        selectedFacts.map((f) => f.text).join('\n\n'),
      selectedFacts,
      evidence,
    },
  });
}
export async function runAgent(options: {
  request: AskRequest;
  provider: ReasoningProvider;
  store: MeasurementStore;
  userId: string;
  signal: AbortSignal;
  now?: () => number;
}): Promise<AgentResult> {
  const { provider, store, userId, signal } = options;
  const request = askRequestSchema.parse(options.request);
  if (!provider.configured) return { state: 'not_configured', data: null };
  const asOf = new Date((options.now ?? Date.now)()).toISOString();
  const contents: ConversationContent[] = [
    {
      role: 'user',
      parts: [
        {
          text: JSON.stringify({
            question: request.question,
            source: request.source,
            timezone: request.timezone,
            asOf,
          }),
        },
      ],
    },
  ];
  const evidence: AgentEvidence[] = [];
  let calls = 0;
  try {
    for (let turn = 0; turn < 8; turn++) {
      signal.throwIfAborted();
      const content = modelContentSchema.parse(
        await withSignal(provider.next(contents, signal), signal),
      );
      signal.throwIfAborted();
      const functions = content.parts.flatMap((p) =>
        p.functionCall ? [p.functionCall] : [],
      );
      if (!functions.length || functions.length > 4)
        throw new Error('Invalid tool turn');
      if (functions.some((f) => f.name === 'respond')) {
        if (functions.length !== 1)
          throw new Error('Respond must follow completed retrieval');
        const args = respondSchema.parse(functions[0]!.args);
        return assembleAnswer(request, provider, asOf, evidence, args.factIds);
      }
      contents.push(content);
      const responses: Record<string, unknown>[] = [];
      for (const fn of functions) {
        if (++calls > 12) throw new Error('Retrieval budget exceeded');
        const valid =
          Object.hasOwn(toolSchemas, fn.name) && fn.name !== 'respond';
        let response: Record<string, unknown>;
        if (!valid)
          response = {
            error: 'Unknown tool. Choose an allowlisted retrieval tool.',
          };
        else {
          const name = fn.name as Exclude<ToolName, 'respond'>;
          if (!toolSchemas[name].safeParse(fn.args).success)
            response = {
              error:
                'Invalid tool arguments. Use the declared schema and bounded ranges.',
            };
          else {
            let output: AgentEvidence;
            try {
              output = await withSignal(
                executeTool(name, fn.args, {
                  request,
                  store,
                  userId,
                  asOf,
                  signal,
                  id: `e${evidence.length + 1}`,
                }),
                signal,
              );
            } catch {
              signal.throwIfAborted();
              const id = `e${evidence.length + 1}`;
              output = evidenceSchema.parse({
                id,
                tool: name,
                title: 'Evidence unavailable',
                range: null,
                status: 'unavailable',
                limitations: [`${id}.f1`],
                facts: [
                  {
                    id: `${id}.f1`,
                    text: 'This evidence could not be retrieved. No conclusion can be drawn from unavailable history.',
                    value: null,
                    range: null,
                  },
                ],
              });
            }
            evidence.push(output);
            response = { evidence: output };
          }
        }
        responses.push({
          functionResponse: {
            name: fn.name,
            ...(fn.id ? { id: fn.id } : {}),
            response,
          },
        });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return assembleAnswer(
      request,
      provider,
      asOf,
      evidence,
      evidence
        .flatMap((e) => e.facts)
        .slice(0, 8)
        .map((f) => f.id),
      true,
    );
  } catch {
    if (signal.aborted) return { state: 'cancelled', data: null };
    return assembleAnswer(
      request,
      provider,
      asOf,
      evidence,
      evidence
        .flatMap((e) => e.facts)
        .slice(0, 8)
        .map((f) => f.id),
      true,
    );
  }
}
/** Single-user process admission and cancellation; no conversation/evidence disk cache. */
export class AgentService {
  private active: AbortController | null = null;
  constructor(
    readonly provider: ReasoningProvider,
    private readonly store: MeasurementStore,
    private readonly userId: string,
  ) {}
  cancel() {
    this.active?.abort();
  }
  async ask(request: AskRequest, signal: AbortSignal): Promise<AgentResult> {
    if (this.active) return { state: 'busy', data: null };
    const controller = new AbortController();
    this.active = controller;
    try {
      return await runAgent({
        request,
        provider: this.provider,
        store: this.store,
        userId: this.userId,
        signal: AbortSignal.any([
          signal,
          controller.signal,
          AbortSignal.timeout(60_000),
        ]),
      });
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
