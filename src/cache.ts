interface Entry<T> {
  value?: T;
  expires: number;
  inflight?: Promise<T>;
}

/**
 * Tiny in-memory TTL cache with in-flight de-duplication: concurrent callers for
 * the same key share a single computation (so we never launch two browsers at
 * once), and a resolved value is reused until it expires. Errors are not cached.
 */
export class TtlCache {
  private map = new Map<string, Entry<unknown>>();

  async get<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = this.map.get(key) as Entry<T> | undefined;

    if (entry?.value !== undefined && entry.expires > now) return entry.value;
    if (entry?.inflight) return entry.inflight;

    const inflight = compute()
      .then((value) => {
        this.map.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .catch((err) => {
        this.map.delete(key); // don't cache failures; allow a retry
        throw err;
      });

    this.map.set(key, { expires: now + ttlMs, inflight });
    return inflight;
  }

  /** Drop cached entries (all, or those whose key starts with `prefix`). */
  clear(prefix?: string): void {
    if (!prefix) {
      this.map.clear();
      return;
    }
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }
}
