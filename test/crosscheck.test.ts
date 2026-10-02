import { describe, expect, it } from "vitest";
import { crossCheck } from "@/lib/analytics/crosscheck";
import { lookThrough } from "@/lib/analytics/lookthrough";
import { getFundHoldings } from "@/lib/sources/resolve";

describe("crossCheck", () => {
  it("compares our XEQT look-through with BlackRock's published one", async () => {
    const lt = (await lookThrough("XEQT", getFundHoldings))!;
    const check = crossCheck(lt.exposures, lt.issuerLookThrough!, 10);
    expect(check.compared).toBe(10);
    // The excerpts carry each fund's top 40 rows, so the very largest names must line up closely.
    expect(check.found).toBe(10);
    expect(check.maxDiff).toBeLessThan(0.0005);
  });

  it("reports a missing name as a full-weight gap", () => {
    const check = crossCheck([], [{ ticker: "AAA", name: "AAA", country: "US", assetClass: "equity", weight: 0.02, isFund: false }]);
    expect(check).toMatchObject({ compared: 1, found: 0, maxDiff: 0.02, worst: { ticker: "AAA" } });
  });
});
