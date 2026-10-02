import { describe, expect, it } from "vitest";
import { cusipFromIsin, normaliseCountry, normaliseTicker, resolveEntities, splitName } from "@/lib/identity";
import type { Holding } from "@/lib/types";

const h = (p: Partial<Holding>): Holding => ({ name: "X", assetClass: "equity", weight: 0.01, isFund: false, ...p });
const same = (a: Partial<Holding>, b: Partial<Holding>) => {
  const g = resolveEntities([h(a), h(b)]);
  return g[0] === g[1];
};

describe("splitName", () => {
  it("separates the share class from the base name", () => {
    expect(splitName("ALPHABET CLASS A")).toEqual({ base: "ALPHABET", shareClass: "A" });
    expect(splitName("ALPHABET INC-A")).toEqual({ base: "ALPHABET", shareClass: "A" });
    expect(splitName("Alphabet Inc - Class C")).toEqual({ base: "ALPHABET", shareClass: "C" });
    expect(splitName("BERKSHIRE HATH-B").shareClass).toBe("B");
    expect(splitName("CHINA CONSTRUCTION BANK CORP H")).toEqual({ base: "CHINACONSTRUCTIONBANK", shareClass: "H" });
    expect(splitName("CCB-H")).toEqual({ base: "CCB", shareClass: "H" });
  });

  it("does not mistake listing markers or title fragments for share classes", () => {
    expect(splitName("BABA-W").shareClass).toBe("");
    expect(splitName("AMERICAN TOWER C", { trailingClass: false }).shareClass).toBe("");
    // Long iShares names are truncated, so a final "I" is half of "INC".
    expect(splitName("ROGERS COMMUNICATIONS NON-VOTING I").shareClass).toBe("");
  });
  it("folds the spelling differences seen between iShares and N-PORT", () => {
    expect(splitName("ELI LILLY").base).toBe(splitName("Eli Lilly & Co").base);
    expect(splitName("EXXONMOBIL HOLDINGS CORP").base).toBe(splitName("Exxon Mobil Corp").base);
    expect(splitName("APPLIED MATERIAL INC").base).toBe(splitName("Applied Materials Inc").base);
    expect(splitName("TJX COS INC/THE").base).toBe(splitName("TJX COS INC").base);
    expect(splitName("MCDONALDS CORP").base).toBe(splitName("McDonald's Corp").base);
    expect(splitName("NORDEA BANK").base).toBe(splitName("Nordea Bank Abp").base);
  });
});

describe("normalisers", () => {
  it("normalises tickers, countries and ISINs", () => {
    expect(normaliseTicker("BRK B")).toBe("BRKB");
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
  const nport = (name: string, altName: string, cusip: string) => ({ name, altName, cusip, country: "US" });

  it("matches iShares rows to N-PORT rows by name and class", () => {
    expect(same({ ticker: "AAPL", name: "APPLE", country: "US" }, nport("Apple Inc", "APPLE INC", "037833100"))).toBe(true);
    expect(same({ ticker: "GOOGL", name: "ALPHABET CLASS A", country: "US" }, nport("Alphabet Inc", "ALPHABET INC-A", "02079K305"))).toBe(true);
    expect(same({ ticker: "META", name: "META PLATFORMS CLASS A", country: "US" }, nport("Meta Platforms Inc", "META PLATFORMS-A", "30303M102"))).toBe(true);
    expect(same({ ticker: "LLY", name: "ELI LILLY", country: "US" }, nport("Eli Lilly & Co", "ELI LILLY & CO", "532457108"))).toBe(true);
  });

  it("keeps share classes apart", () => {
    expect(same({ ticker: "GOOGL", name: "ALPHABET CLASS A", country: "US" }, nport("Alphabet Inc", "ALPHABET INC-C", "02079K107"))).toBe(false);
    expect(same(nport("Alphabet Inc", "ALPHABET INC-A", "02079K305"), nport("Alphabet Inc", "ALPHABET INC-C", "02079K107"))).toBe(false);
    expect(same(nport("Berkshire Hathaway Inc", "BERKSHIRE HATH-B", "084670702"), nport("Berkshire Hathaway Inc", "BERKSHIRE HATH-A", "084670108"))).toBe(false);
  });

  it("chains identifiers: ticker row joins CUSIP row through an ISIN row", () => {
    const g = resolveEntities([
      h({ ticker: "LLY", name: "ELI LILLY", country: "US" }),
      h({ ticker: "LLY", name: "Eli Lilly & Co", isin: "US5324571083", country: "US" }),
      h({ name: "Lilly (Eli) Co", cusip: "532457108", country: "US" }),
    ]);
    expect(new Set(g).size).toBe(1);
  });

  it("matches across issuers whose ticker conventions differ", () => {
    // iShares lists DBS Group as D05, Vanguard as DBS: different schemes, so the tickers do not conflict.
    expect(
      same(
        { ticker: "D05", tickerScheme: "blackrock", name: "DBS GROUP HOLDINGS LTD", country: "SG" },
        { ticker: "DBS", tickerScheme: "vanguard", name: "DBS Group Holdings Ltd", country: "SG" },
      ),
    ).toBe(true);
    // Hong Kong and China labels for the same company.
    expect(
      same(
        { ticker: "9988", tickerScheme: "blackrock", name: "ALIBABA GROUP HOLDING", country: "CN" },
        { name: "Alibaba Group Holding Ltd", altName: "BABA-W", isin: "KYG017191142", country: "HK" },
      ),
    ).toBe(true);
    // A name iShares cut off mid-word.
    expect(same({ ticker: "SPCX", name: "SPACE EXPLORATION TECHNOLOGIES COR", country: "US" }, nport("Space Exploration Technologies Corp", "SPACE EXPLORAT-A", "84612A102"))).toBe(true);
  });

  it("still keeps different tickers apart within one issuer's scheme", () => {
    expect(
      same(
        { ticker: "IBCP", tickerScheme: "blackrock", name: "INDEPENDENT BANK", country: "US" },
        { ticker: "INDB", tickerScheme: "blackrock", name: "INDEPENDENT BANK", country: "US" },
      ),
    ).toBe(false);
  });

  it("never merges different tickers that share a name, or one ticker across countries", () => {
    expect(same({ ticker: "IBCP", name: "INDEPENDENT BANK", country: "US" }, { ticker: "INDB", name: "INDEPENDENT BANK", country: "US" })).toBe(false);
    expect(same({ ticker: "CM", name: "CANADIAN IMPERIAL BANK", country: "CA" }, { ticker: "CM", name: "SOMETHING ELSE", country: "US" })).toBe(false);
  });
});
