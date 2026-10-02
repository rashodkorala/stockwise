import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown } | undefined;
let calls: { url: URL; init: RequestInit }[];
let handler: Handler;
let dir: string;

function stubFetch() {
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    const res = handler(url, init) ?? { status: 404, body: { status: "NOT_FOUND" } };
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { "content-type": "application/json" } });
  });
}

// Fresh modules per test: the client keeps its limiter, denials and caches in memory.
async function load() {
  vi.resetModules();
  const m = await import("@/lib/sources/massive");
  m._resetMassiveDenials();
  m._setMassiveInternals({ limiter: new m.RateLimiter(1000), sleep: async () => {} });
  return m;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stockwise-"));
  process.env.STOCKWISE_DATA_DIR = dir;
  process.env.MASSIVE_API_KEY = "test-key";
  calls = [];
  handler = () => undefined;
  stubFetch();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.MASSIVE_API_KEY;
  delete process.env.STOCKWISE_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("RateLimiter", () => {
  it("allows the per-minute budget, then waits for the window to roll", async () => {
    const { RateLimiter } = await load();
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(5, () => now, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    for (let i = 0; i < 5; i++) await limiter.take();
    expect(waits).toEqual([]);
    await limiter.take();
    expect(waits).toHaveLength(1);
    expect(now).toBeGreaterThanOrEqual(60_000);
  });
});

describe("massiveGet", () => {
  it("sends the key as a bearer token, never in the URL", async () => {
    const m = await load();
    handler = () => ({ body: { results: [] } });
    await m.massiveGet("prices", "/v2/aggs/ticker/AAPL/prev");
    expect(calls[0].url.toString()).toBe("https://api.massive.com/v2/aggs/ticker/AAPL/prev");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("switches to the apiKey parameter if the bearer header is rejected", async () => {
    const m = await load();
    handler = (url) => (url.searchParams.get("apiKey") === "test-key" ? { body: { ok: 1 } } : { status: 401, body: {} });
    expect(await m.massiveGet("prices", "/x")).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("remembers a capability outside the plan and stops calling it", async () => {
    const m = await load();
    handler = () => ({ status: 403, body: { status: "NOT_AUTHORIZED" } });
    await expect(m.massiveGet("etf-global", "/etf-global/v1/constituents")).rejects.toBeInstanceOf(m.MassiveUnavailable);
    await expect(m.massiveGet("etf-global", "/etf-global/v1/constituents")).rejects.toThrow(/does not include etf-global/);
    expect(calls).toHaveLength(1);
    expect(await m.isDenied("prices")).toBe(false);
  });

  it("retries once after a 429", async () => {
    const m = await load();
    let n = 0;
    handler = () => (n++ === 0 ? { status: 429, body: {} } : { body: { ok: 1 } });
    expect(await m.massiveGet("prices", "/x")).toEqual({ ok: 1 });
  });

  it("follows next_url pages", async () => {
    const m = await load();
    handler = (url) =>
      url.searchParams.get("cursor") === "2" ? { body: { results: [3] } } : { body: { results: [1, 2], next_url: "https://api.massive.com/v3/x?cursor=2" } };
    expect(await m.massiveGetAll("reference", "/v3/x", {})).toEqual([1, 2, 3]);
  });

  it("does nothing without a key", async () => {
    delete process.env.MASSIVE_API_KEY;
    const m = await load();
    await expect(m.massiveGet("prices", "/x")).rejects.toBeInstanceOf(m.MassiveUnavailable);
    expect(calls).toHaveLength(0);
  });
});

describe("prices", () => {
  it("prices every US ticker from one daily summary, walking back over the weekend", async () => {
    const m = await load();
    handler = (url) => {
      if (url.pathname.endsWith("/2026-10-02")) return { body: { resultsCount: 0, results: [] } }; // Friday holiday
      if (url.pathname.endsWith("/2026-10-01")) return { body: { results: [{ T: "AAPL", c: 330.32, t: 0 }, { T: "VTI", c: 321.1, t: 0 }] } };
      return undefined;
    };
    const monday = new Date("2026-10-05T15:00:00Z");
    const latest = await m.latestDailyCloses(monday);
    expect(latest.date).toBe("2026-10-01");
    expect(latest.closes.AAPL).toBe(330.32);
    expect(calls.map((c) => c.url.pathname.split("/").pop())).toEqual(["2026-10-02", "2026-10-01"]);
  });

  it("falls back to the previous-day bar for a ticker missing from the summary", async () => {
    const m = await load();
    handler = (url) => {
      if (url.pathname.includes("/grouped/")) return { body: { results: [{ T: "AAPL", c: 330, t: 0 }] } };
      if (url.pathname === "/v2/aggs/ticker/BRK.B/prev") return { body: { results: [{ c: 501.5, t: Date.UTC(2026, 9, 1) }] } };
      return undefined;
    };
    expect(await m.massiveQuote("BRK.B")).toEqual({ price: 501.5, currency: "USD", asOf: "2026-10-01" });
  });
});

describe("ETF Global constituents", () => {
  const sample = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "massive", "constituents-sample.json"), "utf8"));

  it("maps rows and detects percentage weights", async () => {
    const m = await load();
    const f = m.mapConstituents(sample.results, "VTI");
    expect(f).toMatchObject({ source: "massive-etf", asOf: "2026-09-30" });
    expect(f.holdings[0]).toMatchObject({ ticker: "NVDA", tickerScheme: "massive", isin: "US67066G1040", cusip: "67066G104", country: "US", assetClass: "equity" });
    expect(f.holdings[0].weight).toBeCloseTo(0.0635);
    expect(f.holdings.at(-1)!.assetClass).toBe("cash");
  });

  it("accepts weights given as fractions", async () => {
    const m = await load();
    const rows = sample.results.map((r: { weight: number }) => ({ ...r, weight: r.weight / 100 }));
    expect(m.mapConstituents(rows, "VTI").holdings[0].weight).toBeCloseTo(0.0635);
  });

  it("fetches the latest effective date's holdings", async () => {
    const m = await load();
    handler = (url) => {
      if (url.searchParams.get("limit") === "1") return { body: { results: [{ effective_date: "2026-09-30" }] } };
      if (url.searchParams.get("effective_date") === "2026-09-30") return { body: { results: sample.results } };
      return undefined;
    };
    const f = await m.fetchMassiveEtfHoldings("VTI");
    expect(f.holdings).toHaveLength(4);
  });
});

describe("company details and currency", () => {
  it("maps a ticker overview to a name and sector", async () => {
    const m = await load();
    handler = (url) =>
      url.pathname === "/v3/reference/tickers/AAPL"
        ? { body: { results: { name: "Apple Inc.", sic_description: "ELECTRONIC COMPUTERS", locale: "us" } } }
        : undefined;
    expect(await m.massiveCompanyDetails("aapl")).toEqual({
      name: "Apple Inc.",
      sector: "Information Technology",
      industry: "ELECTRONIC COMPUTERS",
      country: "US",
    });
  });

  it("maps SIC descriptions to sectors, keeping unknown ones as they are", async () => {
    const m = await load();
    expect(m.sectorFromSic("PHARMACEUTICAL PREPARATIONS")).toBe("Health Care");
    expect(m.sectorFromSic("NATIONAL COMMERCIAL BANKS")).toBe("Financials");
    expect(m.sectorFromSic("SOMETHING NEW")).toBe("SOMETHING NEW");
  });

  it("falls back from the currencies plan to the forex previous-day bar", async () => {
    const m = await load();
    handler = (url) => {
      if (url.pathname === "/v1/conversion/USD/CAD") return { status: 403, body: {} };
      if (url.pathname === "/v2/aggs/ticker/C:USDCAD/prev") return { body: { results: [{ c: 1.3912, t: 0 }] } };
      return undefined;
    };
    expect(await m.massiveFxRate("USD", "CAD")).toBe(1.3912);
  });
});

describe("getQuote with Massive", () => {
  async function quotes() {
    process.env.STOCKWISE_FIXTURES = "";
    const m = await load(); // resets modules, so quotes.ts sees the same massive module
    const q = await import("@/lib/quotes");
    return { m, q };
  }
  afterEach(() => {
    process.env.STOCKWISE_FIXTURES = "1";
  });

  it("uses Massive for US tickers and reports the price date", async () => {
    const { q } = await quotes();
    handler = (url) => (url.pathname.includes("/grouped/") ? { body: { results: [{ T: "AAPL", c: 330.32, t: 0 }] } } : undefined);
    const quote = await q.getQuote("AAPL", "US");
    expect(quote).toMatchObject({ price: 330.32, currency: "USD", source: "massive" });
    expect(quote.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to Yahoo when Massive cannot price it, and never asks Massive for TSX tickers", async () => {
    const { q } = await quotes();
    handler = (url) => {
      if (url.host === "api.massive.com") return { status: 403, body: {} };
      if (url.host === "query1.finance.yahoo.com") return { body: { chart: { result: [{ meta: { regularMarketPrice: 45.46, currency: "CAD" } }] } } };
      return undefined;
    };
    expect(await q.getQuote("XEQT", "CA")).toMatchObject({ price: 45.46, source: "yahoo" });
    expect(calls.some((c) => c.url.host === "api.massive.com")).toBe(false);
    expect(await q.getQuote("MSFT", "US")).toMatchObject({ source: "yahoo" });
  });
});
