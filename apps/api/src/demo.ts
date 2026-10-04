import { demoOutcomeSchema, type DemoOutcome } from '@trueiris/schemas';
import type { MeasurementStore } from '@trueiris/db';
/** One explicit demo owner; no provider fallback or in-memory database substitution. */
export class DemoService {
  private pending: Promise<DemoOutcome> | null = null;
  private phase: 'preparing' | 'ready' | 'empty' | 'unavailable' = 'empty';
  constructor(
    private readonly store: MeasurementStore | undefined,
    private readonly owner: string | undefined,
  ) {}
  get state() {
    return this.phase;
  }
  async get(): Promise<DemoOutcome> {
    if (this.pending) return { state: 'preparing', data: null };
    if (!this.store?.demo || !this.owner)
      return { state: 'not_configured', data: null };
    try {
      const data = await this.store.demo.get(this.owner);
      const result = demoOutcomeSchema.parse(
        data ? { state: 'ready', data } : { state: 'empty', data: null },
      );
      this.phase = result.state === 'ready' ? 'ready' : 'empty';
      return result;
    } catch {
      this.phase = 'unavailable';
      return { state: 'unavailable', data: null };
    }
  }
  prepare(): Promise<DemoOutcome> {
    if (this.pending) return this.pending;
    this.phase = 'preparing';
    const work = this.runPreparation();
    this.pending = work;
    void work.finally(() => {
      if (this.pending === work) this.pending = null;
    });
    return work;
  }
  private async runPreparation(): Promise<DemoOutcome> {
    try {
      if (!this.store?.demo || !this.owner || !(await this.store.health()))
        throw new Error('Demo unavailable');
      const data = await this.store.demo.seed(this.owner);
      const result = demoOutcomeSchema.parse({ state: 'ready', data });
      this.phase = 'ready';
      return result;
    } catch {
      this.phase = 'unavailable';
      return { state: 'unavailable', data: null };
    }
  }
  async close() {
    await this.pending;
  }
}
