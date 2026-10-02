import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stockwise-"));
  process.env.STOCKWISE_DATA_DIR = dir;
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.STOCKWISE_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("invalidate", () => {
  it("drops matching entries from memory and disk, and keeps the rest", async () => {
    const { diskCached, invalidate } = await import("@/lib/cache");
    await diskCached("ishares:ca:XEQT", 60_000, async () => "xeqt v1");
    await diskCached("nport:VTI", 60_000, async () => "vti v1");
    expect(await readdir(path.join(dir, "cache"))).toHaveLength(2);

    const dropped = await invalidate((key) => key.endsWith(":XEQT"));
    expect(dropped).toBe(2); // the memory entry and the file
    expect(await readdir(path.join(dir, "cache"))).toHaveLength(1);

    // Same process: the dropped key reloads, the other is still served from cache.
    expect(await diskCached("ishares:ca:XEQT", 60_000, async () => "xeqt v2")).toBe("xeqt v2");
    expect(await diskCached("nport:VTI", 60_000, async () => "vti v2")).toBe("vti v1");
  });
});
