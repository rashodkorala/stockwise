import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

// diskCached also memoises in memory, so each test re-imports a fresh module.
async function freshCache() {
  vi.resetModules();
  return import("@/lib/cache");
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stockwise-"));
  process.env.STOCKWISE_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.STOCKWISE_DATA_DIR;
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("diskCached", () => {
  it("serves a value saved by an earlier run without calling the loader", async () => {
    const first = await freshCache();
    expect(await first.diskCached("k", 60_000, async () => ({ n: 1 }))).toEqual({ n: 1 });

    const second = await freshCache();
    const load = vi.fn(async () => ({ n: 2 }));
    expect(await second.diskCached("k", 60_000, load)).toEqual({ n: 1 });
    expect(load).not.toHaveBeenCalled();
  });

  it("refetches once the saved value has expired", async () => {
    const first = await freshCache();
    await first.diskCached("k", 1_000, async () => "old");
    vi.useFakeTimers({ now: Date.now() + 5_000, toFake: ["Date"] });
    const second = await freshCache();
    expect(await second.diskCached("k", 1_000, async () => "new")).toBe("new");
  });

  it("recovers from a corrupt cache file", async () => {
    const first = await freshCache();
    await first.diskCached("k", 60_000, async () => "good");
    const cacheDir = path.join(dir, "cache");
    const [file] = await readdir(cacheDir);
    await writeFile(path.join(cacheDir, file), "{not json");

    const second = await freshCache();
    expect(await second.diskCached("k", 60_000, async () => "fresh")).toBe("fresh");
    expect(JSON.parse(await readFile(path.join(cacheDir, file), "utf8")).value).toBe("fresh");
  });
});
