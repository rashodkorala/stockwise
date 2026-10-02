import { beforeAll, describe, expect, it } from "vitest";
import { crossCheck } from "@/lib/analytics/crosscheck";
import { lookThrough, type LookThrough } from "@/lib/analytics/lookthrough";
import { computeOverlap } from "@/lib/analytics/overlap";
import { getFxRate, getQuote } from "@/lib/quotes";
import { getFundHoldings } from "@/lib/sources/resolve";

const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;
const pp = (w: number) => `${(w * 100).toFixed(3)} pp`;

describe("XEQT against live BlackRock files", () => {
  let lt: LookThrough;
  beforeAll(async () => {
    lt = (await lookThrough("XEQT", getFundHoldings))!;
  });

  it("resolves every underlying fund", () => {
    expect(lt.funds.filter((f) => f.error)).toEqual([]);
    expect(new Set(lt.funds.map((f) => f.ticker))).toEqual(
      new Set(["XEQT", "XTOT", "ITOT", "XIC", "XEF", "IEFA", "XEC", "IEMG"]),
    );
    expect(daysAgo(lt.asOf)).toBeLessThan(10);
  });

  it("adds up to the whole fund", () => {
    const total = lt.exposures.reduce((s, e) => s + e.weight, 0);
    console.log(`XEQT: ${lt.exposures.length} securities, total weight ${(total * 100).toFixed(2)}%`);
    expect(total).toBeGreaterThan(0.98);
    expect(total).toBeLessThan(1.02);
    expect(lt.exposures.length).toBeGreaterThan(5000);
  });

  it("matches BlackRock's own look-through for its 25 largest names", () => {
    expect(lt.issuerLookThrough?.length).toBeGreaterThan(5000);
    const check = crossCheck(lt.exposures, lt.issuerLookThrough!, 25);
    console.log(`Cross-check top 25: found ${check.found}, max diff ${pp(check.maxDiff)}`, check.worst);
    expect(check.found).toBe(25);
    expect(check.maxDiff).toBeLessThan(0.0005);
    const wide = crossCheck(lt.exposures, lt.issuerLookThrough!, 500);
    console.log(`Cross-check top 500: found ${wide.found}, max diff ${pp(wide.maxDiff)}`, wide.worst);
  });
});

describe("SEC N-PORT", () => {
  it("loads VTI's latest filing", async () => {
    const r = await getFundHoldings("VTI");
    if (!r.ok) throw new Error(JSON.stringify(r.attempts));
    expect(r.fund.source).toBe("edgar-nport");
    expect(r.fund.holdings.length).toBeGreaterThan(3000);
    expect(daysAgo(r.fund.asOf)).toBeLessThan(200);
  });

  it("loads QQQ, now an N-PORT filer", async () => {
    const r = await getFundHoldings("QQQ");
    if (!r.ok) throw new Error(JSON.stringify(r.attempts));
    expect(r.fund.holdings.length).toBeGreaterThan(90);
  });

  it("matches ITOT (iShares, by ticker) to VTI (N-PORT, by CUSIP and name)", async () => {
    const [itot, vti] = await Promise.all([lookThrough("ITOT", getFundHoldings), lookThrough("VTI", getFundHoldings)]);
    const o = computeOverlap(itot!, vti!);
    console.log(`ITOT vs VTI: overlap ${(o.overlap * 100).toFixed(1)}%, ITOT in VTI ${(o.aInB * 100).toFixed(1)}%, shared ${o.shared.length}`);
    expect(o.overlap).toBeGreaterThan(0.85);
  });
});

describe("Discovery and quotes", () => {
  it("discovers an iShares Canada fund that has no registry product ID", async () => {
    const r = await getFundHoldings("XGRO");
    if (!r.ok) throw new Error(JSON.stringify(r.attempts));
    expect(r.fund.source).toBe("ishares-ca");
    expect(r.fund.holdings.length).toBeGreaterThan(3);
  });

  it("prices a TSX listing and converts USD to CAD", async () => {
    const q = await getQuote("XEQT", "CA");
    expect(q.currency).toBe("CAD");
    expect(q.price).toBeGreaterThan(10);
    const fx = await getFxRate("USD", "CAD");
    expect(fx).toBeGreaterThan(1);
    expect(fx).toBeLessThan(2);
  });
});

describe("Vanguard Canada", () => {
  let veqt: LookThrough;
  beforeAll(async () => {
    veqt = (await lookThrough("VEQT", getFundHoldings))!;
  });

  it("looks VEQT through to stocks via VUN > VTI and VEE > VWO", () => {
    expect(veqt.funds.filter((f) => f.error)).toEqual([]);
    expect(new Set(veqt.funds.map((f) => f.ticker))).toEqual(new Set(["VEQT", "VUN", "VTI", "VCN", "VIU", "VEE", "VWO"]));
    const total = veqt.exposures.reduce((s, e) => s + e.weight, 0);
    console.log(`VEQT: ${veqt.exposures.length} securities, total weight ${(total * 100).toFixed(2)}%, as of ${veqt.asOf}`);
    expect(total).toBeGreaterThan(0.98);
    expect(total).toBeLessThan(1.02);
    expect(daysAgo(veqt.asOf)).toBeLessThan(45); // month-end holdings
  });

  it("overlaps heavily with XEQT", async () => {
    const o = computeOverlap((await lookThrough("XEQT", getFundHoldings))!, veqt);
    console.log(`XEQT vs VEQT: overlap ${(o.overlap * 100).toFixed(1)}%, XEQT matched ${(o.aInB * 100).toFixed(1)}%, VEQT matched ${(o.bInA * 100).toFixed(1)}%`);
    expect(o.overlap).toBeGreaterThan(0.8);
    expect(o.aInB).toBeGreaterThan(0.95);
  });

  it("loads a balanced portfolio with bond funds (VGRO)", async () => {
    const lt = (await lookThrough("VGRO", getFundHoldings))!;
    expect(lt.funds.filter((f) => f.error)).toEqual([]);
    expect(lt.exposures.some((e) => e.assetClass === "fixed_income")).toBe(true);
  });
});

// Runs only when MASSIVE_API_KEY is set, in the environment or .env.local
// (free plan: prices and company details; ETF Global and currencies fall back).
describe.runIf(!process.env.MASSIVE_API_KEY)("Massive (no key)", () => {
  it("is skipped because MASSIVE_API_KEY is not set", () => {
    console.log("Massive: MASSIVE_API_KEY not set (environment or .env.local), skipping Massive checks");
  });
});

describe.skipIf(!process.env.MASSIVE_API_KEY)("Massive", () => {
  it("prices US tickers from Massive with a trading date", async () => {
    const q = await getQuote("AAPL", "US");
    console.log(`AAPL ${q.price} ${q.currency} from ${q.source} as of ${q.asOf}`);
    expect(q.source).toBe("massive");
    expect(daysAgo(q.asOf!)).toBeLessThan(7);
  });

  it("names a single stock from its ticker overview", async () => {
    const { massiveCompanyDetails } = await import("@/lib/sources/massive");
    const d = await massiveCompanyDetails("AAPL");
    expect(d.name).toMatch(/Apple/);
    expect(d.sector).toBe("Information Technology");
  });

  it("reports which capabilities the plan includes, and still resolves US funds", async () => {
    const { isDenied } = await import("@/lib/sources/massive");
    const r = await getFundHoldings("VTI");
    expect(r.ok).toBe(true);
    console.log(`VTI holdings from ${r.ok ? r.fund.source : "-"}; ETF Global in plan: ${!(await isDenied("etf-global"))}`);
    const fx = await getFxRate("USD", "CAD");
    expect(fx).toBeGreaterThan(1);
  });
});
