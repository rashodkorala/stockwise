import { describe, expect, it } from "vitest";
import { breakdown, lookThrough, type LookThrough } from "@/lib/analytics/lookthrough";
import { computeOverlap } from "@/lib/analytics/overlap";
import { computePortfolioExposure } from "@/lib/analytics/portfolio";
import { getFundHoldings } from "@/lib/sources/resolve";
import type { FundHoldings, Holding, HoldingsResult } from "@/lib/types";

const h = (p: Partial<Holding>): Holding => ({ name: "X", assetClass: "equity", weight: 0, isFund: false, ...p });
const fund = (ticker: string, holdings: Holding[]): FundHoldings => ({ ticker, name: ticker, asOf: "2026-01-01", source: "sample", holdings });
const loaderFor = (funds: FundHoldings[]) => async (sym: string): Promise<HoldingsResult> => {
  const f = funds.find((x) => x.ticker === sym.replace(/\.TO$/, ""));
  return f ? { ok: true, fund: f, attempts: [] } : { ok: false, attempts: [{ source: "sample", error: "missing" }] };
};

describe("lookThrough", () => {
  it("expands XEQT through its four underlying funds", async () => {
    const lt = (await lookThrough("XEQT", getFundHoldings))!;
    expect(lt.tree.funds.map((f) => f.ticker).sort()).toEqual(["ITOT", "XEC", "XEF", "XIC"]);
    const apple = lt.exposures.find((e) => e.ticker === "AAPL")!;
    expect(apple.weight).toBeCloseTo(0.4481 * 0.0591, 6);
    expect(apple.via[0].path).toEqual(["XEQT", "ITOT"]);
    expect(lt.exposures.find((e) => e.ticker === "RY")!.weight).toBeCloseTo(0.2512 * 0.0661, 6);
    expect(lt.funds.every((f) => !f.error)).toBe(true);
  });

  it("goes three levels deep (VEQT > VUN > VTI) across file formats", async () => {
    const lt = (await lookThrough("VEQT", getFundHoldings))!;
    const nvda = lt.exposures.find((e) => e.ticker === "NVDA")!;
    expect(nvda.via[0].path).toEqual(["VEQT", "VUN", "VTI"]);
    expect(nvda.weight).toBeCloseTo(0.4452 * 0.999 * 0.0641, 6);
  });

  it("guards against cycles and keeps unloadable funds as leaves", async () => {
    const a = fund("A", [h({ ticker: "B", name: "B ETF", isFund: true, assetClass: "fund", weight: 0.5 }), h({ ticker: "Z", name: "Z ETF", isFund: true, assetClass: "fund", weight: 0.5 })]);
    const b = fund("B", [h({ ticker: "A", name: "A ETF", isFund: true, assetClass: "fund", weight: 1 })]);
    const lt = (await lookThrough("A", loaderFor([a, b])))!;
    expect(lt.leaves.map((l) => l.holding.ticker).sort()).toEqual(["A", "Z"]);
    expect(lt.funds.find((f) => f.ticker === "Z")?.error).toMatch(/missing/);
  });

  it("returns null when the root fund cannot be loaded", async () => {
    expect(await lookThrough("NOPE", loaderFor([]))).toBeNull();
  });

  it("breaks exposures down by sector", async () => {
    const lt = (await lookThrough("XEQT", getFundHoldings))!;
    const sectors = breakdown(lt.exposures, "sector");
    const total = lt.exposures.reduce((s, e) => s + e.weight, 0);
    expect(sectors.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(total);
    expect(sectors.map((x) => x.weight)).toEqual([...sectors.map((x) => x.weight)].sort((a, b) => b - a));
    const it = sectors.find((x) => x.label === "Information Technology")!;
    const itStocks = lt.exposures.filter((e) => e.sector === "Information Technology");
    expect(it.weight).toBeCloseTo(itStocks.reduce((s, e) => s + e.weight, 0));
  });
});

describe("computeOverlap", () => {
  const lt = async (funds: FundHoldings[], t: string) => (await lookThrough(t, loaderFor(funds)))! as LookThrough;
  const p = fund("P", [h({ ticker: "AAA", name: "AAA", country: "US", weight: 0.6 }), h({ ticker: "BBB", name: "BBB", country: "US", weight: 0.4 })]);
  const q = fund("Q", [h({ ticker: "AAA", name: "AAA", country: "US", weight: 0.2 }), h({ ticker: "CCC", name: "CCC", country: "US", weight: 0.7 }), h({ name: "USD CASH", assetClass: "cash", weight: 0.1 })]);
  const r = fund("R", [h({ ticker: "DDD", name: "DDD", country: "US", weight: 1 })]);

  it("is 100% for a fund against itself", async () => {
    const x = await lt([p], "P");
    expect(computeOverlap(x, x).overlap).toBeCloseTo(1);
  });

  it("is 0% for disjoint funds", async () => {
    expect(computeOverlap(await lt([p], "P"), await lt([r], "R")).overlap).toBe(0);
  });

  it("sums the smaller weight of shared names, ignoring cash", async () => {
    const o = computeOverlap(await lt([p], "P"), await lt([q], "Q"));
    // Q rescaled without cash: AAA 0.2/0.9
    expect(o.overlap).toBeCloseTo(0.2 / 0.9);
    expect(o.shared.map((s) => s.ticker)).toEqual(["AAA"]);
    expect(o.onlyA.map((s) => s.ticker)).toEqual(["BBB"]);
    expect(o.onlyB.map((s) => s.ticker)).toEqual(["CCC"]);
    expect(o.aInB).toBeCloseTo(0.6);
  });

  it("finds substantial overlap between XEQT and VEQT, matching N-PORT rows to iShares rows", async () => {
    const o = computeOverlap((await lookThrough("XEQT", getFundHoldings))!, (await lookThrough("VEQT", getFundHoldings))!);
    expect(o.overlap).toBeGreaterThan(0.5);
    const tickers = o.shared.map((s) => s.ticker);
    expect(tickers).toEqual(expect.arrayContaining(["AAPL", "MSFT", "GOOGL", "GOOG", "BRKB", "RY", "ASML"]));
    expect(o.onlyB.map((s) => s.ticker ?? s.name)).toContain("Super Micro Computer Inc");
  });
});

describe("computePortfolioExposure", () => {
  it("adds a directly held stock to the same stock inside an ETF", async () => {
    const xeqt = (await lookThrough("XEQT", getFundHoldings))!;
    const result = computePortfolioExposure([
      { ticker: "XEQT", value: 9000, fund: xeqt },
      { ticker: "AAPL", value: 1000, security: h({ ticker: "AAPL", name: "APPLE INC", country: "US" }) },
    ]);
    expect(result.total).toBe(10000);
    const apple = result.exposures.find((e) => e.ticker === "AAPL")!;
    expect(apple.value).toBeCloseTo(1000 + 9000 * 0.4481 * 0.0591, 2);
    expect(result.exposures[0].ticker).toBe("AAPL");
  });

  it("builds a symmetric overlap matrix for fund positions", async () => {
    const xeqt = (await lookThrough("XEQT", getFundHoldings))!;
    const veqt = (await lookThrough("VEQT", getFundHoldings))!;
    const { overlapMatrix } = computePortfolioExposure([
      { ticker: "XEQT", value: 1, fund: xeqt },
      { ticker: "VEQT", value: 1, fund: veqt },
    ]);
    expect(overlapMatrix.tickers).toEqual(["XEQT", "VEQT"]);
    expect(overlapMatrix.values[0][0]).toBe(1);
    expect(overlapMatrix.values[0][1]).toBe(overlapMatrix.values[1][0]);
  });
});
