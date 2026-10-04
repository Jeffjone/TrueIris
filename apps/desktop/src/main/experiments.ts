import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  experimentActionSchema,
  experimentOutcomeSchema,
  type ExperimentAction,
  type ExperimentOutcome,
} from '@trueiris/schemas';
import { storageConfigured } from './storage/queue';
export class ExperimentClient {
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly request = fetch,
  ) {}
  async action(
    input: ExperimentAction,
    signal?: AbortSignal,
  ): Promise<ExperimentOutcome> {
    const action = experimentActionSchema.parse(input);
    if (!storageConfigured(this.url, this.token))
      return { state: 'not_configured', data: null };
    try {
      const response = await this.request(
        new URL('/experiments/action', this.url),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(action),
          redirect: 'error',
          signal: AbortSignal.any([
            AbortSignal.timeout(20_000),
            ...(signal ? [signal] : []),
          ]),
        },
      );
      if (response.status === 401 || response.status === 403)
        return { state: 'unauthorized', data: null };
      if (!response.ok) return { state: 'unavailable', data: null };
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new Error('Experiment response limit');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = experimentOutcomeSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (result.state === 'ready') {
        const selected = result.data.selected;
        if (
          action.type === 'create' &&
          (!selected ||
            JSON.stringify(selected.experiment.definition) !==
              JSON.stringify(action.definition))
        )
          throw new Error('Wrong definition');
        if (
          !['list', 'create', 'remove'].includes(action.type) &&
          (!selected ||
            selected.experiment.id !== ('id' in action ? action.id : null))
        )
          throw new Error('Wrong experiment');
        if (
          selected &&
          !result.data.experiments.some(
            (e) => JSON.stringify(e) === JSON.stringify(selected.experiment),
          )
        )
          throw new Error('Wrong experiment list');
        if ((action.type === 'list' || action.type === 'remove') && selected)
          throw new Error('Unexpected selection');
        if (
          (action.type === 'status' &&
            selected?.experiment.status !== action.status) ||
          (action.type === 'record' &&
            !selected?.sessions.some(
              (session) =>
                JSON.stringify(session.input) === JSON.stringify(action.input),
            )) ||
          (action.type === 'remove_session' &&
            selected?.sessions.some(
              (session) => session.id === action.sessionId,
            )) ||
          (action.type === 'remove' &&
            result.data.experiments.some(
              (experiment) => experiment.id === action.id,
            ))
        )
          throw new Error('Unconfirmed experiment action');
      }
      return result;
    } catch {
      return { state: 'unavailable', data: null };
    }
  }
  async export(id: string, path: string, signal: AbortSignal) {
    const result = await this.action({ type: 'get', id }, signal);
    if (result.state !== 'ready' || !result.data.selected)
      throw new Error('Export unavailable');
    const temporary = `${path}.${randomUUID()}.partial`,
      file = await open(temporary, 'wx', 0o600);
    try {
      signal.throwIfAborted();
      await file.write(JSON.stringify(result.data.selected, null, 2) + '\n');
      await file.close();
      signal.throwIfAborted();
      await rename(temporary, path);
    } catch {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw new Error('Export unavailable');
    }
  }
}
