import { open, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { exportPageSchema, contextExportPageSchema } from '@trueiris/schemas';

interface ExportOptions {
  kind?: 'context';
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}
/** Stream to a sibling temporary file and replace the selected path only on success. */
export async function exportMeasurements(
  apiUrl: string,
  token: string,
  path: string,
  options: ExportOptions = {},
) {
  const temporary = `${path}.${randomUUID()}.partial`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    let cursor: string | null = null;
    do {
      options.signal?.throwIfAborted();
      const url = new URL(
        options.kind === 'context' ? '/context/export' : '/data/export',
        apiUrl,
      );
      if (cursor) url.searchParams.set('cursor', cursor);
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const deadline = AbortSignal.timeout(10_000);
        response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal: options.signal
            ? AbortSignal.any([options.signal, deadline])
            : deadline,
          redirect: 'error',
        });
        if (response.ok || (response.status !== 429 && response.status < 500))
          break;
        if (attempt === 2) break;
        const delay =
          response.status === 429
            ? Math.min(
                60,
                Math.max(1, Number(response.headers.get('retry-after')) || 60),
              ) * 1000
            : 1000 * 2 ** attempt;
        if (options.wait) await options.wait(delay);
        else
          await wait(
            delay,
            undefined,
            options.signal ? { signal: options.signal } : {},
          );
      }
      if (!response?.ok) throw new Error('Export unavailable');
      const input: unknown = await response.json();
      const page =
        options.kind === 'context'
          ? contextExportPageSchema.parse(input)
          : exportPageSchema.parse(input);
      const records = 'intervals' in page ? page.intervals : page.measurements;
      for (const measurement of records) {
        options.signal?.throwIfAborted();
        await file.write(`${JSON.stringify(measurement)}\n`);
      }
      if (cursor !== null && cursor === page.next)
        throw new Error('Export cursor did not advance');
      cursor = page.next;
    } while (cursor);
    await file.close();
    options.signal?.throwIfAborted();
    await rename(temporary, path);
  } catch {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new Error('Export failed; incomplete file removed');
  }
}
