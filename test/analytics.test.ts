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
  it("expands XEQT through XTOT, ITOT, XIC, XEF, XEC and their US slices", async () => {
    const lt = (await lookThrough("XEQT", getFundHoldings))!;
    expect(lt.name).toBe("iShares Core Equity ETF Portfolio");
    expect(lt.tree.funds.map((f) => f.ticker).sort()).toEqual(["ITOT", "XEC", "XEF", "XIC", "XTOT"]);
    expect(lt.funds.every((f) => !f.error)).toBe(true);
    expect(new Set(lt.funds.map((f) => f.ticker))).toEqual(new Set(["XEQT", "XTOT", "ITOT", "XIC", "XEF", "IEFA", "XEC", "IEMG"]));

    // Apple arrives twice: XEQT > XTOT > ITOT and XEQT > ITOT.
    const apple = lt.exposures.find((e) => e.ticker === "AAPL")!;
    // Weights come from exact market values, so they differ from the rounded CSV column in the fifth decimal.
    expect(apple.weight).toBeCloseTo(0.3078 * 0.9992 * 0.0656 + 0.1499 * 0.0656, 4);
    expect(apple.via.map((v) => v.path.join(">")).sort()).toEqual(["XEQT>ITOT", "XEQT>XTOT>ITOT"]);
    expect(lt.exposures.find((e) => e.ticker === "RY")!.weight).toBeCloseTo(0.2489 * 0.0773, 4);
  });

  it("goes one level deeper where a Canadian fund holds its US twin (XEF > IEFA)", async () => {
    const lt = (await lookThrough("XEF", getFundHoldings))!;
    const viaIefa = lt.leaves.filter((l) => l.path.join(">") === "XEF>IEFA");
    expect(viaIefa.length).toBeGreaterThan(10);
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

  it("matches iShares rows to N-PORT rows on real data (ITOT vs VTI)", async () => {
    const o = computeOverlap((await lookThrough("ITOT", getFundHoldings))!, (await lookThrough("VTI", getFundHoldings))!);
    const tickers = o.shared.map((s) => s.ticker);
    expect(tickers).toEqual(expect.arrayContaining(["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "AVGO", "TSLA", "LLY", "JPM", "BRK B"]));
    // Both excerpts list only the top 40 names, so most of each side is shared.
    expect(o.overlap).toBeGreaterThan(0.8);
    expect(new Set(tickers).size).toBe(tickers.length);
  });
});

describe("computePortfolioExposure", () => {
  it("adds a directly held stock to the same stock inside an ETF", async () => {
    const xeqt = (await lookThrough("XEQT", getFundHoldings))!;
    const result = computePortfolioExposure([
      { ticker: "XEQT", value: 9000, fund: xeqt },
      { ticker: "AAPL", value: 1000, security: h({ ticker: "AAPL", name: "AAPL", country: "US" }) },
    ]);
    expect(result.total).toBe(10000);
    const apple = result.exposures.find((e) => e.ticker === "AAPL")!;
    expect(apple.value).toBeCloseTo(1000 + 9000 * (0.3078 * 0.9992 + 0.1499) * 0.0656, 0);
    expect(result.exposures[0].ticker).toBe("AAPL");
    expect(apple.name).toBe("APPLE");
  });

  it("builds a symmetric overlap matrix for fund positions", async () => {
    const xeqt = (await lookThrough("XEQT", getFundHoldings))!;
    const vti = (await lookThrough("VTI", getFundHoldings))!;
    const { overlapMatrix } = computePortfolioExposure([
      { ticker: "XEQT", value: 1, fund: xeqt },
      { ticker: "VTI", value: 1, fund: vti },
    ]);
    expect(overlapMatrix.tickers).toEqual(["XEQT", "VTI"]);
    expect(overlapMatrix.values[0][0]).toBe(1);
    expect(overlapMatrix.values[0][1]).toBe(overlapMatrix.values[1][0]);
  });
});
