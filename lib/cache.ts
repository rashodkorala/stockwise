interface Entry<T> {
  expires: number;
  value: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Memoises an async loader per key for `ttlMs`, sharing in-flight requests.
 * Failed loads are evicted so the next call retries.
 *
 * Parsed results are cached in memory because several raw payloads (N-PORT XML,
 * SEC ticker files) exceed the 2MB limit of Next's fetch cache.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;

  const value = load();
  store.set(key, { expires: now + ttlMs, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
