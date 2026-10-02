import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { latestNportAccession, parseNportXml } from "@/lib/sources/edgarNport";
import { findInScreener, parseIsharesCsv, parseIsharesDate } from "@/lib/sources/ishares";
import { mapFmpHoldings } from "@/lib/sources/fmp";
import { isKnownFund } from "@/lib/sources/resolve";

const fixture = (f: string) => readFileSync(path.join(__dirname, "..", "fixtures", "holdings", f), "utf8");

describe("iShares CSV", () => {
  it("parses a fund-of-funds and flags its funds", () => {
    const f = parseIsharesCsv(fixture("XEQT.csv"), "XEQT", "ca", isKnownFund);
    expect(f.name).toBe("iShares Core Equity ETF Portfolio");
    expect(f.asOf).toBe("2026-09-30");
    expect(f.currency).toBe("CAD");
    expect(f.holdings.map((h) => h.ticker)).toEqual(["ITOT", "XIC", "XEF", "XEC", "CAD"]);
    expect(f.holdings.filter((h) => h.isFund)).toHaveLength(4);
    expect(f.holdings[0].weight).toBeCloseTo(0.4481);
    expect(f.holdings[0].country).toBe("US");
    expect(f.holdings[4].assetClass).toBe("cash");
  });

  it("parses stock rows, stops at the disclaimer, and classifies cash", () => {
    const f = parseIsharesCsv(fixture("ITOT.csv"), "ITOT", "us", isKnownFund);
    const aapl = f.holdings.find((h) => h.ticker === "AAPL")!;
    expect(aapl).toMatchObject({ name: "APPLE INC", sector: "Information Technology", country: "US", assetClass: "equity" });
    expect(aapl.marketValue).toBeGreaterThan(0);
    expect(f.holdings.find((h) => h.ticker === "XTSLA")!.assetClass).toBe("cash");
    expect(f.holdings.some((h) => /content contained/.test(h.name))).toBe(false);
  });

  it("rejects files without a holdings table", () => {
    expect(() => parseIsharesCsv("<html>Not found</html>", "X", "us")).toThrow(/No holdings table/);
  });

  it("parses dates", () => {
    expect(parseIsharesDate("Sep 30, 2026")).toBe("2026-09-30");
    expect(parseIsharesDate("30-Sep-2026")).toBe("2026-09-30");
  });

  it("finds products in either screener layout", () => {
    const keyed = { "309480": { localExchangeTicker: "XEQT", productPageUrl: "/ca/investors/en/products/309480/ishares-core-equity-etf-portfolio" } };
    expect(findInScreener(keyed, "xeqt")).toEqual({ productId: "309480", slug: "ishares-core-equity-etf-portfolio" });
    const nested = { data: { rows: [{ ticker: "ITOT", productPageUrl: "https://www.ishares.com/us/products/239724/ishares-core-sp-total-us-stock-market-etf" }] } };
    expect(findInScreener(nested, "ITOT")?.productId).toBe("239724");
    expect(findInScreener(nested, "IVV")).toBeUndefined();
  });
});

describe("SEC N-PORT", () => {
  it("parses holdings with identifiers and asset categories", () => {
    const f = parseNportXml(fixture("VTI.xml"), "VTI");
    expect(f.asOf).toBe("2026-06-30");
    expect(f.source).toBe("edgar-nport");
    const nvda = f.holdings.find((h) => h.ticker === "NVDA")!;
    expect(nvda).toMatchObject({ cusip: "67066G104", isin: "US67066G1040", country: "US", assetClass: "equity" });
    expect(nvda.weight).toBeCloseTo(0.0641);
    const aapl = f.holdings.find((h) => h.cusip === "037833100")!;
    expect(aapl.cusip).toBe("037833100"); // leading zero survives
    expect(f.holdings.find((h) => h.name.includes("Liquidity"))!.assetClass).toBe("fund");
  });

  it("picks the newest NPORT-P accession from the Atom feed", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><category term="NPORT-P"/><content type="text/xml"><accession-number>0000036405-26-000123</accession-number><filing-type>NPORT-P</filing-type></content></entry>
      <entry><category term="NPORT-P"/><content type="text/xml"><accession-number>0000036405-26-000045</accession-number><filing-type>NPORT-P</filing-type></content></entry>
    </feed>`;
    expect(latestNportAccession(atom)).toBe("0000036405-26-000123");
  });
});

describe("FMP", () => {
  it("maps holdings and strips exchange suffixes", () => {
    const f = mapFmpHoldings(
      [{ asset: "VUN.TO", name: "Vanguard US Total Market Index ETF", weightPercentage: 44.5, updatedAt: "2026-09-30 00:00:00" }],
      "VEQT",
      isKnownFund,
    );
    expect(f.holdings[0]).toMatchObject({ ticker: "VUN", isFund: true });
    expect(f.holdings[0].weight).toBeCloseTo(0.445);
    expect(f.asOf).toBe("2026-09-30");
  });
});
