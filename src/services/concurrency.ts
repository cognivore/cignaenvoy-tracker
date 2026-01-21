/**
 * Concurrency utilities for bounded parallelism.
 *
 * Provides helpers for processing items with controlled concurrency
 * to avoid overwhelming external APIs or system resources.
 */

/**
 * Map over items with bounded concurrency.
 *
 * @param items - Items to process
 * @param concurrency - Maximum concurrent operations
 * @param fn - Async function to apply to each item
 * @returns Results in the same order as inputs
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item, index);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

/**
 * Map over items with bounded concurrency, collecting successful results.
 * Errors are logged but don't stop processing.
 *
 * @param items - Items to process
 * @param concurrency - Maximum concurrent operations
 * @param fn - Async function to apply to each item
 * @param onError - Optional error handler
 * @returns Successful results (order not guaranteed)
 */
export async function mapWithConcurrencySettled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onError?: (item: T, error: unknown) => void
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item === undefined) continue;
      try {
        const result = await fn(item, index);
        results.push(result);
      } catch (err) {
        onError?.(item, err);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

/**
 * Flat map over items with bounded concurrency.
 * Each function call can return multiple results.
 *
 * @param items - Items to process
 * @param concurrency - Maximum concurrent operations
 * @param fn - Async function returning array of results
 * @returns Flattened results
 */
export async function flatMapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R[]>
): Promise<R[]> {
  const results = await mapWithConcurrency(items, concurrency, fn);
  return results.flat();
}

/**
 * Flat map over items with bounded concurrency, collecting successful results.
 *
 * @param items - Items to process
 * @param concurrency - Maximum concurrent operations
 * @param fn - Async function returning array of results
 * @param onError - Optional error handler
 * @returns Flattened successful results
 */
export async function flatMapWithConcurrencySettled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R[]>,
  onError?: (item: T, error: unknown) => void
): Promise<R[]> {
  const results = await mapWithConcurrencySettled(items, concurrency, fn, onError);
  return results.flat();
}

/**
 * A simple semaphore for limiting concurrent operations.
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * Execute a function with a permit.
   */
  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Process queue with dedicated workers.
 * Useful for rate-limited APIs like OCR.
 */
export class WorkerQueue<T, R> {
  private queue: Array<{
    item: T;
    resolve: (result: R) => void;
    reject: (error: unknown) => void;
  }> = [];
  private workers: number;
  private activeWorkers = 0;
  private fn: (item: T) => Promise<R>;

  constructor(workers: number, fn: (item: T) => Promise<R>) {
    this.workers = workers;
    this.fn = fn;
  }

  private async runWorker(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      try {
        const result = await this.fn(task.item);
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }
    this.activeWorkers--;
  }

  private maybeStartWorker(): void {
    if (this.activeWorkers < this.workers && this.queue.length > 0) {
      this.activeWorkers++;
      void this.runWorker();
    }
  }

  /**
   * Add an item to the queue and return a promise for its result.
   */
  enqueue(item: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.maybeStartWorker();
    });
  }

  /**
   * Process all items and return results.
   */
  async processAll(items: T[]): Promise<R[]> {
    return Promise.all(items.map((item) => this.enqueue(item)));
  }
}
