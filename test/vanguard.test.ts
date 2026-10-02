import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lookThrough } from "@/lib/analytics/lookthrough";
import { computeOverlap } from "@/lib/analytics/overlap";
import { getFundHoldings } from "@/lib/sources/resolve";
import { collectPages, mapVanguardPayload, type VanguardItem, type VanguardPayload } from "@/lib/sources/vanguard";

// Excerpts of real responses from the GraphQL service behind vanguard.ca (pnpm snapshot --excerpt).
const payload = (t: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "holdings", `${t}.vanguard.json`), "utf8")) as VanguardPayload;

describe("Vanguard Canada holdings", () => {
  const veqt = mapVanguardPayload(payload("VEQT"), "VEQT");

  it("maps a fund of funds", () => {
    expect(veqt).toMatchObject({ name: "Vanguard All-Equity ETF Portfolio", currency: "CAD", source: "vanguard-ca", asOf: "2026-08-31" });
    expect(veqt.holdings.filter((h) => h.isFund).map((h) => h.ticker)).toEqual(["VUN", "VCN", "VIU", "VEE"]);
    expect(veqt.holdings[0].weight).toBeCloseTo(0.4477273, 7);
    expect(veqt.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 6);
  });

  it("classifies cash and currency forwards", () => {
    const cad = veqt.holdings.find((h) => h.name === "Canadian Dollar")!;
    expect(cad.assetClass).toBe("cash");
    expect(veqt.holdings.filter((h) => h.assetClass === "derivative").length).toBeGreaterThan(0);
  });

  it("maps stocks with ticker, country and sector", () => {
    const viu = mapVanguardPayload(payload("VIU"), "VIU");
    expect(viu.holdings[0]).toMatchObject({
      ticker: "005930",
      tickerScheme: "vanguard",
      name: "Samsung Electronics Co Ltd",
      country: "KR",
      sector: "Information Technology",
      assetClass: "equity",
    });
  });

  it("points VUN at VTI as a US fund to look through", () => {
    const vun = mapVanguardPayload(payload("VUN"), "VUN");
    expect(vun.holdings[0]).toMatchObject({ ticker: "VTI", country: "US", isFund: true });
  });

  it("follows pagination keys until the last page", async () => {
    const row = (n: number): VanguardItem => ({
      issuerName: `Co ${n}`, securityLongDescription: null, gicsSectorDescription: null, marketValuePercentage: 1,
      sedol1: null, ticker: `T${n}`, securityType: "EQ.STOCK", effectiveDate: "2026-08-31", marketValueBaseCurrency: 1, bloombergIsoCountry: "CA",
    });
    const pages: Record<string, { items: VanguardItem[]; lastItemKey: string | null }> = {
      start: { items: [row(1), row(2)], lastItemKey: "k1" },
      k1: { items: [row(3)], lastItemKey: "k2" },
      k2: { items: [row(4)], lastItemKey: null },
    };
    const seen: (string | null)[] = [];
    const items = await collectPages(async (key) => (seen.push(key), pages[key ?? "start"]));
    expect(items.map((i) => i.ticker)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(seen).toEqual([null, "k1", "k2"]);
  });
});

describe("VEQT look-through", () => {
  it("expands VEQT > VUN > VTI and VEQT > VEE > VWO across Vanguard and SEC sources", async () => {
    const lt = (await lookThrough("VEQT", getFundHoldings))!;
    expect(lt.funds.filter((f) => f.error)).toEqual([]);
    expect(new Set(lt.funds.map((f) => f.ticker))).toEqual(new Set(["VEQT", "VUN", "VTI", "VCN", "VIU", "VEE", "VWO"]));
    const nvda = lt.exposures.find((e) => e.name === "NVIDIA Corp")!;
    expect(nvda.via[0].path).toEqual(["VEQT", "VUN", "VTI"]);
    expect(lt.exposures.find((e) => e.ticker === "RY")!.via[0].path).toEqual(["VEQT", "VCN"]);
  });

  it("finds XEQT and VEQT largely overlapping", async () => {
    const o = computeOverlap((await lookThrough("XEQT", getFundHoldings))!, (await lookThrough("VEQT", getFundHoldings))!);
    const shared = o.shared.map((s) => s.ticker ?? s.name);
    // Canadian names match by ticker, international by ticker or name, US through VTI's N-PORT names.
    expect(shared).toEqual(expect.arrayContaining(["RY", "TD", "SHOP", "NVDA", "AAPL", "MSFT", "005930"]));
    expect(o.overlap).toBeGreaterThan(0.6);
  });
});
