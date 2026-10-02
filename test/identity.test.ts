import { describe, expect, it } from "vitest";
import { cusipFromIsin, normaliseCountry, normaliseName, normaliseTicker, resolveEntities } from "@/lib/identity";
import type { Holding } from "@/lib/types";

const h = (p: Partial<Holding>): Holding => ({ name: "X", assetClass: "equity", weight: 0.01, isFund: false, ...p });

describe("normalisers", () => {
  it("strips suffixes and keeps share classes", () => {
    expect(normaliseName("ALPHABET INC-CL A")).toBe("ALPHABET CLASS A");
    expect(normaliseName("Alphabet Inc Class A")).toBe("ALPHABET CLASS A");
    expect(normaliseName("JPMorgan Chase & Co")).toBe(normaliseName("JPMORGAN CHASE & CO"));
    expect(normaliseName("The Home Depot, Inc.")).toBe("HOME DEPOT");
  });
  it("normalises tickers, countries and ISINs", () => {
    expect(normaliseTicker("BRK.B")).toBe("BRKB");
    expect(normaliseTicker("-")).toBeUndefined();
    expect(normaliseCountry("United States")).toBe("US");
    expect(normaliseCountry("Korea (South)")).toBe("KR");
    expect(normaliseCountry("-")).toBeUndefined();
    expect(cusipFromIsin("US0378331005")).toBe("037833100");
    expect(cusipFromIsin("NL0010273215")).toBeUndefined();
  });
});

describe("resolveEntities", () => {
  it("matches an iShares row to an N-PORT row by name", () => {
    const g = resolveEntities([
      h({ ticker: "AAPL", name: "APPLE INC", country: "US" }),
      h({ name: "Apple Inc", cusip: "037833100", isin: "US0378331005", country: "US" }),
    ]);
    expect(g[0]).toBe(g[1]);
  });

  it("chains identifiers: ticker row joins CUSIP row through an ISIN row", () => {
    const g = resolveEntities([
      h({ ticker: "LLY", name: "ELI LILLY", country: "US" }),
      h({ ticker: "LLY", name: "Eli Lilly & Co", isin: "US5324571083", country: "US" }),
      h({ name: "Lilly (Eli) Co", cusip: "532457108", country: "US" }),
    ]);
    expect(new Set(g).size).toBe(1);
  });

  it("keeps share classes apart when the issuer name is shared", () => {
    const g = resolveEntities([
      h({ name: "Alphabet Inc", cusip: "02079K305", country: "US" }),
      h({ name: "Alphabet Inc", cusip: "02079K107", country: "US" }),
    ]);
    expect(g[0]).not.toBe(g[1]);
  });

  it("does not merge the same ticker on different exchanges", () => {
    const g = resolveEntities([
      h({ ticker: "CM", name: "CANADIAN IMPERIAL BANK", country: "CA" }),
      h({ ticker: "CM", name: "SOMETHING ELSE", country: "US" }),
    ]);
    expect(g[0]).not.toBe(g[1]);
  });
});
