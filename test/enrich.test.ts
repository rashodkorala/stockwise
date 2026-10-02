import { describe, expect, it } from "vitest";
import { lookThrough } from "@/lib/analytics/lookthrough";
import { enrichHoldings, withEnrichment } from "@/lib/sources/enrich";
import { getFundHoldings } from "@/lib/sources/resolve";
import type { Holding } from "@/lib/types";

const h = (p: Partial<Holding>): Holding => ({ name: "X", assetClass: "equity", weight: 0.01, isFund: false, ...p });

describe("enrichHoldings", () => {
  it("copies ticker and sector from the matching reference row, keeping its ticker scheme", () => {
    const [nvda, alphabetC] = enrichHoldings(
      [
        h({ name: "NVIDIA Corp", altName: "NVIDIA CORP", cusip: "67066G104", country: "US", tickerScheme: "sec" }),
        h({ name: "Alphabet Inc", altName: "ALPHABET INC-C", cusip: "02079K107", country: "US", tickerScheme: "sec" }),
      ],
      [
        h({ ticker: "NVDA", tickerScheme: "blackrock", name: "NVIDIA", country: "US", sector: "Information Technology" }),
        h({ ticker: "GOOGL", tickerScheme: "blackrock", name: "ALPHABET CLASS A", country: "US", sector: "Communication" }),
        h({ ticker: "GOOG", tickerScheme: "blackrock", name: "ALPHABET CLASS C", country: "US", sector: "Communication" }),
      ],
    );
    expect(nvda).toMatchObject({ ticker: "NVDA", tickerScheme: "blackrock", sector: "Information Technology", cusip: "67066G104" });
    expect(alphabetC.ticker).toBe("GOOG");
  });

  it("leaves rows alone when nothing matches, and never touches non-equity rows", () => {
    const rows = [h({ name: "Obscure Co", country: "US" }), h({ name: "Money Market", assetClass: "cash" })];
    expect(enrichHoldings(rows, [h({ ticker: "AAPL", name: "APPLE", country: "US", sector: "IT" })])).toEqual(rows);
  });
});

describe("withEnrichment", () => {
  it("gives VTI's N-PORT rows tickers and sectors from ITOT", async () => {
    const vti = (await lookThrough("VTI", withEnrichment(getFundHoldings)))!;
    const nvda = vti.exposures.find((e) => e.name === "NVIDIA Corp")!;
    expect(nvda).toMatchObject({ ticker: "NVDA", sector: "Information Technology" });
  });
});
