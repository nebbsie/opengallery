type Resolver = (value?: unknown) => void;

class Semaphore {
  private capacity: number;
  private inUse = 0;
  private queue: Resolver[] = [];

  constructor(initialCapacity: number) {
    this.capacity = Math.max(1, initialCapacity);
  }

  setCapacity(n: number) {
    const next = Math.max(1, Math.floor(n));
    this.capacity = next;
    this.drain();
  }

  private drain() {
    while (this.inUse < this.capacity && this.queue.length > 0) {
      this.inUse++;
      const resolve = this.queue.shift()!;
      resolve();
    }
  }

  async acquire(): Promise<void> {
    if (this.inUse < this.capacity) {
      this.inUse++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release() {
    this.inUse = Math.max(0, this.inUse - 1);
    this.drain();
  }
}

// Deprecated: global concurrency in watcher has been removed in favor of
// API-controlled leasing. This file remains for future use if needed.
