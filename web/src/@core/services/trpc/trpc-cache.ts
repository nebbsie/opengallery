export interface CacheItem {
  value: unknown;
  expiresAt: number;
}

export class TrpcCache {
  private cache = new Map<string, CacheItem>();
  private readonly cacheDuration = 500;

  get(key: string): unknown | undefined {
    const item = this.cache.get(key);
    if (item && Date.now() < item.expiresAt) {
      return item.value;
    }
    if (item) {
      this.cache.delete(key);
    }
    return undefined;
  }

  set(key: string, value: unknown): void {
    const expiresAt = Date.now() + this.cacheDuration;
    this.cache.set(key, { value, expiresAt });
  }

  clear(): void {
    this.cache.clear();
  }
}
