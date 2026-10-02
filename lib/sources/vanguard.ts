import { DAY, diskCached, HOUR } from "../cache";
import { fetchJson, fetchText } from "../http";
import { normaliseCountry } from "../identity";
import type { AssetClass, FundHoldings, Holding } from "../types";

/**
 * Vanguard Canada publishes no holdings files. Its website reads them from a
 * GraphQL service behind www.vanguard.ca, which this module calls the same way
 * the site does. It is undocumented, so failures fall through to the paid
 * fallback like any other source.
 */
const GPX_URL = "https://www.vanguard.ca/gpx/graphql";
const SITE_PAGE = "https://www.vanguard.ca/en/home";
const PAGE_SIZE = 1500;
const MAX_PAGES = 20;

/** Verified ticker-to-port-ID map (October 2026), used when discovery fails. */
const KNOWN_PORT_IDS: Record<string, string> = {
  VEQT: "9692", VGRO: "9579", VBAL: "9578", VCNS: "9577", VCIP: "9691", VRIF: "9870",
  VUN: "9557", VUS: "9551", VFV: "9563", VSP: "9562", VGG: "9566", VGH: "9564",
  VCN: "9561", VCE: "9554", VDY: "9560", VRE: "9559",
  VIU: "9569", VI: "9570", VDU: "9558", VEF: "9555", VA: "9550", VE: "9549", VIDY: "9742",
  VEE: "9556", VXC: "9548", VVO: "9828", VMO: "9835", VVL: "9795",
  VAB: "9552", VSB: "9553", VSC: "9565", VLB: "1811", VGV: "1817", VCB: "1936",
  VBU: "9567", VBG: "9568", VGAB: "9841", VVSG: "D003", VUDV: "D018", VUDH: "D019", VIGG: "D020", VCOR: "D021",
};

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetchJson<GqlResponse<T>>(GPX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-consumer-id": "ca0" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.errors?.length || !res.data) throw new Error(`Vanguard: ${res.errors?.[0]?.message ?? "empty response"}`);
  return res.data;
}

const LISTINGS_QUERY = `query Listings($portIds: [String!]!) {
  funds(portIds: $portIds) {
    profile { portId listings { identifiers(altIds: ["Ticker - Canada"]) { altIdValue } } }
  }
}`;

interface ListingsData {
  funds: { profile: { portId: string; listings: { identifiers: { altIdValue: string }[] | null }[] | null } | null }[];
}

/** Maps every Vanguard Canada ETF ticker to its port ID, using the site's own fund list. */
export function vanguardPortIds(): Promise<Record<string, string>> {
  return diskCached("vanguard-ca:port-ids", DAY, async () => {
    try {
      const page = await fetchText(SITE_PAGE);
      const ids = page.match(/"portIds":"([^"]+)"/)?.[1]?.split(",");
      if (!ids?.length) throw new Error("no port IDs on the site page");
      const data = await gql<ListingsData>(LISTINGS_QUERY, { portIds: ids });
      const map: Record<string, string> = {};
      for (const f of data.funds) {
        for (const l of f.profile?.listings ?? []) {
          for (const id of l.identifiers ?? []) map[id.altIdValue.toUpperCase()] = f.profile!.portId;
        }
      }
      return Object.keys(map).length ? { ...KNOWN_PORT_IDS, ...map } : KNOWN_PORT_IDS;
    } catch {
      return KNOWN_PORT_IDS;
    }
  });
}

export interface VanguardItem {
  issuerName: string | null;
  securityLongDescription: string | null;
  gicsSectorDescription: string | null;
  marketValuePercentage: number | null;
  sedol1: string | null;
  ticker: string | null;
  securityType: string | null;
  effectiveDate: string | null;
  marketValueBaseCurrency: number | null;
  bloombergIsoCountry: string | null;
}

/** The raw shape kept in fixtures: what the GraphQL service returned, pages merged. */
export interface VanguardPayload {
  fundFullName: string;
  fundCurrency: string;
  items: VanguardItem[];
}

const HOLDINGS_QUERY = `query Holdings($portIds: [String!], $lastItemKey: String) {
  funds(portIds: $portIds) { profile { fundFullName fundCurrency } }
  borHoldings(portIds: $portIds) {
    holdings(limit: ${PAGE_SIZE}, lastItemKey: $lastItemKey) {
      items {
        issuerName securityLongDescription gicsSectorDescription marketValuePercentage sedol1
        ticker securityType effectiveDate marketValueBaseCurrency bloombergIsoCountry
      }
      totalHoldings
      lastItemKey
    }
  }
}`;

type One<T> = T | T[];
const first = <T>(v: One<T> | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

interface HoldingsData {
  funds: { profile: { fundFullName: string; fundCurrency: string } | null }[];
  borHoldings: One<{ holdings: One<{ items: VanguardItem[]; totalHoldings: number; lastItemKey: string | null }> }>;
}

/** Follows lastItemKey until the service reports no more pages. */
export async function collectPages(
  fetchPage: (lastItemKey: string | null) => Promise<{ items: VanguardItem[]; lastItemKey: string | null }>,
): Promise<VanguardItem[]> {
  const items: VanguardItem[] = [];
  let key: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(key);
    items.push(...res.items);
    if (!res.lastItemKey || res.lastItemKey === key) return items;
    key = res.lastItemKey;
  }
  throw new Error(`Vanguard: more than ${MAX_PAGES * PAGE_SIZE} holdings`);
}

export async function fetchVanguardPayload(portId: string): Promise<VanguardPayload> {
  let profile: { fundFullName: string; fundCurrency: string } | undefined;
  const items = await collectPages(async (lastItemKey) => {
    const data = await gql<HoldingsData>(HOLDINGS_QUERY, { portIds: [portId], lastItemKey });
    profile ??= data.funds[0]?.profile ?? undefined;
    const holdings = first(first(data.borHoldings)?.holdings);
    if (!holdings) throw new Error("Vanguard: no holdings in response");
    return { items: holdings.items ?? [], lastItemKey: holdings.lastItemKey };
  });
  if (!profile) throw new Error("Vanguard: unknown fund");
  return { fundFullName: profile.fundFullName, fundCurrency: profile.fundCurrency, items };
}

function assetClassFor(securityType: string | null): AssetClass {
  const t = (securityType ?? "").toUpperCase();
  if (t === "EQ.ETF" || t.startsWith("MF.")) return "fund";
  if (t.startsWith("EQ.") && t !== "EQ.WRT" && t !== "EQ.RIGHT") return "equity";
  if (t === "CRNY" || t.startsWith("MM") || t.startsWith("CASH")) return "cash";
  if (t.startsWith("CT.") || t.startsWith("DE.")) return "derivative";
  if (t.startsWith("FI.")) return "fixed_income";
  return "other";
}

/** Turns the service's rows into holdings. Weights arrive as percentages with five decimals. */
export function mapVanguardPayload(payload: VanguardPayload, ticker: string): FundHoldings {
  const holdings: Holding[] = [];
  let asOf = "";
  for (const it of payload.items) {
    if (it.marketValuePercentage === null) continue;
    const assetClass = assetClassFor(it.securityType);
    if (it.effectiveDate && it.effectiveDate > asOf) asOf = it.effectiveDate;
    holdings.push({
      ticker: it.ticker ?? undefined,
      tickerScheme: "vanguard",
      name: it.issuerName ?? it.securityLongDescription ?? it.ticker ?? "Unknown",
      altName: it.issuerName && it.securityLongDescription !== it.issuerName ? (it.securityLongDescription ?? undefined) : undefined,
      country: normaliseCountry(it.bloombergIsoCountry ?? undefined),
      sector: it.gicsSectorDescription ?? undefined,
      assetClass,
      weight: it.marketValuePercentage / 100,
      marketValue: it.marketValueBaseCurrency ?? undefined,
      isFund: assetClass === "fund",
    });
  }
  if (holdings.length === 0) throw new Error(`Vanguard returned no holdings for ${ticker}`);
  return { ticker, name: payload.fundFullName, asOf, currency: payload.fundCurrency, source: "vanguard-ca", holdings };
}

export function fetchVanguardHoldings(ticker: string): Promise<FundHoldings> {
  return diskCached(`vanguard-ca:${ticker}`, 12 * HOUR, async () => {
    const portId = (await vanguardPortIds())[ticker.toUpperCase()];
    if (!portId) throw new Error(`${ticker} is not a Vanguard Canada ETF`);
    return mapVanguardPayload(await fetchVanguardPayload(portId), ticker);
  });
}
