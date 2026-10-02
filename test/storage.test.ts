import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_PORTFOLIO, readPortfolio, validatePortfolio, writePortfolio } from "@/lib/storage";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stockwise-"));
  process.env.STOCKWISE_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.STOCKWISE_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("portfolio storage", () => {
  it("returns an empty portfolio before anything is saved", async () => {
    expect(await readPortfolio()).toEqual(EMPTY_PORTFOLIO);
  });

  it("round-trips a saved portfolio", async () => {
    await writePortfolio({ baseCurrency: "USD", positions: [{ ticker: " xeqt ", units: 100, currency: "CAD" }] });
    const saved = await readPortfolio();
    expect(saved.baseCurrency).toBe("USD");
    expect(saved.positions).toEqual([{ ticker: "XEQT", units: 100, marketValue: null, currency: "CAD" }]);
    expect(saved.savedAt).toMatch(/^\d{4}-/);
  });

  it("rejects bad input", () => {
    expect(() => validatePortfolio({ positions: "nope" })).toThrow(/list/);
    expect(() => validatePortfolio({ positions: [{ ticker: "<script>" }] })).toThrow(/invalid ticker/);
    expect(() => validatePortfolio({ positions: Array.from({ length: 51 }, () => ({ ticker: "A" })) })).toThrow(/At most/);
    expect(validatePortfolio({ positions: [{ ticker: "A", units: -5, marketValue: Infinity }] }).positions[0]).toMatchObject({
      units: null,
      marketValue: null,
    });
  });
});
