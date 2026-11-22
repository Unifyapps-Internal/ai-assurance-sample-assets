export interface Step {
  name: string;
  status: 'succeeded' | 'failed';
  ms: number;
  in: Record<string, unknown>;
  out: Record<string, unknown>;
}

export interface Run {
  runId: string;
  trigger: 'manual' | 'schedule';
  status: 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string;
  steps: Step[];
  output: Record<string, unknown>;
  notice: string;
}

/** Where runs are kept. Memory by default; any store with these three calls can replace it. */
export interface RunStore {
  save(run: Run): void;
  get(runId: string): Run | undefined;
  recent(limit: number): Run[];
  /** Drops runs that finished before the cutoff (epoch milliseconds). */
  purge(cutoff: number): void;
}

export class MemoryRunStore implements RunStore {
  private runs: Run[] = [];

  save(run: Run): void {
    this.runs.push(run);
  }

  get(runId: string): Run | undefined {
    return this.runs.find((run) => run.runId === runId);
  }

  recent(limit: number): Run[] {
    return this.runs.slice(-limit).reverse();
  }

  purge(cutoff: number): void {
    this.runs = this.runs.filter((run) => Date.parse(run.finishedAt) >= cutoff);
  }
}
