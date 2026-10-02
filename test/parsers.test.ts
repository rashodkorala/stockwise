import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { latestNportAccession, parseNportXml } from "@/lib/sources/edgarNport";
import { mapFmpHoldings } from "@/lib/sources/fmp";
import { findInScreener, parseIsharesCsv, parseIsharesDate } from "@/lib/sources/ishares";
import { isKnownFund } from "@/lib/sources/resolve";

// Fixtures are excerpts of real files (npm run snapshot -- --excerpt).
const fixture = (f: string) => readFileSync(path.join(__dirname, "..", "fixtures", "holdings", f), "utf8");

describe("BlackRock Canada CSV", () => {
  const xeqt = parseIsharesCsv(fixture("XEQT.csv"), "XEQT", "ca", isKnownFund);

  it("parses a file with no fund-name row", () => {
    expect(xeqt.name).toBe("XEQT"); // the provider fills in the real name
    expect(xeqt.asOf).toBe("2026-09-30");
    expect(xeqt.currency).toBe("CAD");
  });

  it("reads only the direct holdings from the first table and flags funds", () => {
    expect(xeqt.holdings.map((h) => h.ticker)).toEqual(["XTOT", "XIC", "XEF", "ITOT", "XEC", "CAD", "USD"]);
    expect(xeqt.holdings.filter((h) => h.isFund).map((h) => h.ticker)).toEqual(["XTOT", "XIC", "XEF", "ITOT", "XEC"]);
    expect(xeqt.holdings[0].weight).toBeCloseTo(0.3078);
    expect(xeqt.holdings.find((h) => h.ticker === "ITOT")!.country).toBe("US");
    expect(xeqt.holdings.find((h) => h.ticker === "XIC")!.country).toBe("CA");
    expect(xeqt.holdings.find((h) => h.ticker === "CAD")!.assetClass).toBe("cash");
  });

  it("returns BlackRock's own look-through from the second table", () => {
    const lt = xeqt.issuerLookThrough!;
    expect(lt.length).toBeGreaterThan(20);
    expect(lt[0]).toMatchObject({ ticker: "NVDA", country: "US", assetClass: "equity" });
    expect(lt[0].weight).toBeCloseTo(0.0341);
    expect(lt.every((h) => !h.isFund)).toBe(true);
  });

  it("classifies currency forwards as derivatives", () => {
    const csv = 'Fund Holdings as of,"Sep 30, 2026"\n\nTicker,Name,Sector,Asset Class,Market Value,Weight (%)\n"KRW","KRW/USD","Cash and/or Derivatives","FX","-28.89","0.00"\n';
    expect(parseIsharesCsv(csv, "X", "ca").holdings[0].assetClass).toBe("derivative");
  });

  it("finds a fund's slice of a US iShares fund", () => {
    const xef = parseIsharesCsv(fixture("XEF.csv"), "XEF", "ca", isKnownFund);
    expect(xef.holdings.find((h) => h.ticker === "IEFA")).toMatchObject({ isFund: true, country: "US" });
    expect(xef.issuerLookThrough).toBeUndefined();
  });
});

describe("iShares US CSV", () => {
  it("parses the name row, metadata and holdings", () => {
    const f = parseIsharesCsv(fixture("ITOT.csv"), "ITOT", "us", isKnownFund);
    expect(f.name).toBe("iShares Core S&P Total U.S. Stock Market ETF");
    expect(f.asOf).toBe("2026-09-30");
    expect(f.holdings[0]).toMatchObject({ ticker: "NVDA", name: "NVIDIA", sector: "Information Technology", country: "US" });
    expect(f.holdings.find((h) => h.ticker === "GOOG")!.name).toBe("ALPHABET CLASS C");
  });

  it("rejects pages that are not holdings files", () => {
    expect(() => parseIsharesCsv("<!DOCTYPE html><html>…</html>", "X", "us")).toThrow(/No holdings table/);
  });

  it("parses dates", () => {
    expect(parseIsharesDate("Sep 30, 2026")).toBe("2026-09-30");
    expect(parseIsharesDate("30-Sep-2026")).toBe("2026-09-30");
  });
});

describe("iShares screener", () => {
  it("finds products and names in the keyed layout", () => {
    const feed = {
      "343519": {
        localExchangeTicker: "XTOT",
        fundName: "iShares Core S&P Total U.S. Stock Market Index ETF",
        productPageUrl: "/ca/investors/en/products/343519/ishares-core-s-p-total-u-s-stock-market-index-etf",
      },
    };
    expect(findInScreener(feed, "xtot")).toEqual({
      productId: "343519",
      slug: "ishares-core-s-p-total-u-s-stock-market-index-etf",
      name: "iShares Core S&P Total U.S. Stock Market Index ETF",
    });
    expect(findInScreener(feed, "IVV")).toBeUndefined();
  });
});

describe("SEC N-PORT", () => {
  const vti = parseNportXml(fixture("VTI.xml"), "VTI");

  it("parses the filing header", () => {
    expect(vti.asOf).toBe("2026-06-30");
    expect(vti.source).toBe("edgar-nport");
    expect(vti.name).toBe("VANGUARD TOTAL STOCK MARKET INDEX FUND");
  });

  it("keeps the issuer name for display and the title for matching", () => {
    const nvda = vti.holdings.find((h) => h.cusip === "67066G104")!;
    expect(nvda).toMatchObject({ name: "NVIDIA Corp", altName: "NVIDIA CORP", isin: "US67066G1040", country: "US", assetClass: "equity" });
    expect(vti.holdings.find((h) => h.cusip === "037833100")).toBeDefined(); // leading zero survives
    const alphabet = vti.holdings.filter((h) => h.name === "Alphabet Inc").map((h) => h.altName);
    expect(alphabet.sort()).toEqual(["ALPHABET INC-A", "ALPHABET INC-C"]);
  });

  it("picks the newest NPORT-P accession from the Atom feed", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><category term="NPORT-P"/><content type="text/xml"><accession-number>0000036405-26-000480</accession-number><filing-type>NPORT-P</filing-type></content></entry>
      <entry><category term="NPORT-P"/><content type="text/xml"><accession-number>0000036405-26-000323</accession-number><filing-type>NPORT-P</filing-type></content></entry>
    </feed>`;
    expect(latestNportAccession(atom)).toBe("0000036405-26-000480");
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
