import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./paths";

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

/**
 * Like `cached`, but also keeps the value in data/cache/ so it survives a
 * restart of the local app. Expired or unreadable files are ignored and
 * refetched; a failed write only costs the next restart a refetch.
 */
export function diskCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  return cached(key, ttlMs, async () => {
    const dir = path.join(dataDir(), "cache");
    const file = path.join(dir, `${createHash("sha1").update(key).digest("hex").slice(0, 20)}.json`);
    try {
      const entry = JSON.parse(await readFile(file, "utf8")) as { key: string; savedAt: number; value: T };
      if (entry.key === key && Date.now() - entry.savedAt < ttlMs) return entry.value;
    } catch {
      // Missing or corrupt: fall through and refetch.
    }
    const value = await load();
    try {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ key, savedAt: Date.now(), value }));
      await rename(tmp, file);
    } catch {
      // Read-only disk or similar: keep serving from memory.
    }
    return value;
  });
}
