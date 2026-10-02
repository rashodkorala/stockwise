import { XMLParser } from "fast-xml-parser";
import { cached, DAY } from "../cache";
import { fetchSec } from "../http";
import { normaliseCountry } from "../identity";
import type { AssetClass, FundHoldings, Holding } from "../types";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // CUSIPs such as "037833100" must stay strings.
  parseTagValue: false,
  isArray: (name) => ["invstOrSec", "entry", "isin", "ticker", "other"].includes(name),
});

type Node = Record<string, unknown>;

const text = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") return text((v as Node)["#text"]);
  const s = String(v).trim();
  return s && s !== "N/A" ? s : undefined;
};

const attrValue = (v: unknown): string | undefined => {
  const first = Array.isArray(v) ? v[0] : v;
  return first && typeof first === "object" ? text((first as Node)["@_value"]) : undefined;
};

function assetClassFor(assetCat?: string, issuerCat?: string): AssetClass {
  if (issuerCat === "RF" || assetCat === "RF") return "fund";
  switch (assetCat) {
    case "EC":
    case "EP":
      return "equity";
    case "STIV":
      return "cash";
    case "DBT":
    case "ABS-MBS":
    case "ABS-ABCP":
    case "ABS-CBDO":
    case "ABS-O":
    case "LON":
    case "SN":
      return "fixed_income";
    case "DCO":
    case "DCR":
    case "DE":
    case "DFE":
    case "DIR":
    case "DO":
      return "derivative";
    default:
      return "other";
  }
}

/** Parses the primary_doc.xml of an N-PORT-P filing. */
export function parseNportXml(doc: string, ticker: string): FundHoldings {
  const root = xml.parse(doc) as Node;
  const form = ((root.edgarSubmission as Node)?.formData ?? {}) as Node;
  const gen = (form.genInfo ?? {}) as Node;
  const secs = ((form.invstOrSecs as Node)?.invstOrSec ?? []) as Node[];
  if (secs.length === 0) throw new Error("N-PORT filing lists no investments");

  const holdings: Holding[] = [];
  for (const s of secs) {
    const pct = Number(text(s.pctVal));
    if (!Number.isFinite(pct)) continue;
    const ids = (s.identifiers ?? {}) as Node;
    const assetClass = assetClassFor(text(s.assetCat), text(s.issuerCat));
    const isShort = text(s.payoffProfile) === "Short";
    holdings.push({
      ticker: attrValue(ids.ticker),
      // The issuer name reads well; the abbreviated title carries the share class ("ALPHABET INC-A").
      name: text(s.name) ?? text(s.title) ?? "Unknown",
      altName: text(s.title),
      isin: attrValue(ids.isin),
      cusip: text(s.cusip),
      country: normaliseCountry(text(s.invCountry)),
      assetClass,
      weight: ((isShort ? -1 : 1) * Math.abs(pct)) / 100,
      marketValue: Number(text(s.valUSD)) || undefined,
      isFund: assetClass === "fund",
    });
  }

  return {
    ticker,
    name: text(gen.seriesName) ?? ticker,
    asOf: text(gen.repPdDate) ?? text(gen.repPdEnd) ?? "",
    currency: "USD",
    source: "edgar-nport",
    holdings,
  };
}

interface SeriesRef {
  cik: number;
  seriesId: string;
}

async function seriesIndex(): Promise<Map<string, SeriesRef>> {
  return cached("sec:company_tickers_mf", DAY, async () => {
    const raw = JSON.parse(await fetchSec("https://www.sec.gov/files/company_tickers_mf.json")) as {
      fields: string[];
      data: (string | number)[][];
    };
    const iCik = raw.fields.indexOf("cik");
    const iSeries = raw.fields.indexOf("seriesId");
    const iSymbol = raw.fields.indexOf("symbol");
    const map = new Map<string, SeriesRef>();
    for (const row of raw.data) {
      const symbol = String(row[iSymbol]).toUpperCase();
      if (!map.has(symbol)) map.set(symbol, { cik: Number(row[iCik]), seriesId: String(row[iSeries]) });
    }
    return map;
  });
}

/** Picks the newest NPORT-P accession from EDGAR's per-series Atom feed. */
export function latestNportAccession(atom: string): string | undefined {
  const feed = xml.parse(atom) as Node;
  const entries = ((feed.feed as Node)?.entry ?? []) as Node[];
  for (const e of entries) {
    const content = (e.content ?? {}) as Node;
    const type = text(content["filing-type"]) ?? text((e.category as Node)?.["@_term"]);
    const acc = text(content["accession-number"]);
    if (type?.startsWith("NPORT-P") && acc) return acc;
  }
  return undefined;
}

/** Locates the newest public N-PORT document for a fund ticker. */
export async function nportDocumentUrl(ticker: string): Promise<string> {
  const ref = (await seriesIndex()).get(ticker.toUpperCase());
  if (!ref) throw new Error(`${ticker} is not a US-registered fund in SEC's ticker list`);
  const atom = await fetchSec(
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ref.seriesId}&type=NPORT-P&dateb=&owner=include&count=10&output=atom`,
  );
  const acc = latestNportAccession(atom);
  if (!acc) throw new Error(`No public N-PORT filing found for ${ticker}`);
  return `https://www.sec.gov/Archives/edgar/data/${ref.cik}/${acc.replace(/-/g, "")}/primary_doc.xml`;
}

export function fetchNportHoldings(ticker: string): Promise<FundHoldings> {
  return cached(`nport:${ticker}`, DAY, async () => parseNportXml(await fetchSec(await nportDocumentUrl(ticker), 60_000), ticker));
}
