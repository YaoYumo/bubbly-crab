// Cooperative CPU work. The 4ms budget is soft: one generator step is atomic.
// Jobs must yield within large loops; no work is executed by request().
export class IdleWork {
  constructor(paused = () => false) {
    this.paused = paused;
    this.jobs = new Map();
    this.handle = null;
    this.stats = { slices: 0, steps: 0, maxSliceMs: 0, errors: 0 };
  }
  request(key, factory) {
    if (!this.jobs.has(key)) this.jobs.set(key, factory());
    this.schedule();
  }
  schedule() {
    if (this.handle !== null || !this.jobs.size) return;
    const run = (deadline) => {
      this.handle = null;
      if (!this.paused() && !globalThis.document?.hidden) this.slice(deadline);
      this.schedule();
    };
    if (globalThis.requestIdleCallback) {
      this.idle = true;
      this.handle = requestIdleCallback(run, { timeout: 250 });
    } else {
      this.idle = false;
      this.handle = setTimeout(() => run(null), 32);
      this.handle.unref?.();
    }
  }
  slice(deadline) {
    const start = performance.now();
    let steps = 0;
    while (this.jobs.size && performance.now() - start < 4 && steps < 64) {
      if (steps && deadline && !deadline.didTimeout && deadline.timeRemaining() < 1) break;
      const [key, job] = this.jobs.entries().next().value;
      try {
        if (job.next().done) this.jobs.delete(key);
      } catch (error) {
        this.jobs.delete(key);
        this.stats.errors++;
        this.stats.lastError = error.message;
      }
      steps++;
    }
    this.stats.steps += steps;
    this.stats.slices++;
    this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, performance.now() - start);
  }
  cancel() {
    if (this.handle !== null) {
      if (this.idle) cancelIdleCallback(this.handle);
      else clearTimeout(this.handle);
    }
    this.handle = null;
    for (const job of this.jobs.values()) job.return?.();
    this.jobs.clear();
  }
  // Explicit asynchronous warmup, e.g. tests/export preparation. Never a render loop.
  async drain({ timeout = 10000, signal } = {}) {
    const start = performance.now();
    while (this.jobs.size && !signal?.aborted && performance.now() - start < timeout) {
      this.slice();
      if (this.jobs.size) await new Promise((r) => setTimeout(r, 0));
    }
    return { pending: this.jobs.size, ...this.stats };
  }
}
