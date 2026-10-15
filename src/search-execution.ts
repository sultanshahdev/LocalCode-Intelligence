export class SearchOverloadedError extends Error {
  constructor() {
    super('Search capacity is temporarily exhausted. Please retry shortly.');
    this.name = 'SearchOverloadedError';
  }
}

export class SearchQueueAbortedError extends Error {
  constructor() {
    super('Search request was cancelled.');
    this.name = 'SearchQueueAbortedError';
  }
}

interface QueuedSearch<T> {
  run: () => Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  signal: AbortSignal | undefined;
  timeout: ReturnType<typeof setTimeout>;
}

/** Serializes expensive local inference and bounds waiting work. */
export class SearchExecutionController {
  private active = 0;
  private readonly queue: QueuedSearch<unknown>[] = [];

  constructor(
    private readonly maxActive = 1,
    private readonly maxQueued = 2,
    private readonly queueTimeoutMs = 30_000,
  ) {}

  execute<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new SearchQueueAbortedError());
    if (this.active < this.maxActive) return this.start(run);
    if (this.queue.length >= this.maxQueued) return Promise.reject(new SearchOverloadedError());

    return new Promise<T>((resolve, reject) => {
      let entry!: QueuedSearch<T>;
      entry = {
        run, resolve, reject, signal,
        timeout: setTimeout(() => this.remove(entry, new SearchOverloadedError()), this.queueTimeoutMs),
      };
      const abort = () => this.remove(entry, new SearchQueueAbortedError());
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(entry as QueuedSearch<unknown>);
    });
  }

  private async start<T>(run: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      return await run();
    } finally {
      this.active -= 1;
      this.next();
    }
  }

  private next(): void {
    const entry = this.queue.shift();
    if (entry === undefined) return;
    clearTimeout(entry.timeout);
    if (entry.signal?.aborted) {
      entry.reject(new SearchQueueAbortedError());
      this.next();
      return;
    }
    void this.start(entry.run).then(entry.resolve, entry.reject);
  }

  private remove(entry: QueuedSearch<unknown>, error: Error): void {
    const index = this.queue.indexOf(entry);
    if (index < 0) return;
    this.queue.splice(index, 1);
    clearTimeout(entry.timeout);
    entry.reject(error);
  }
}
