import type { Holding } from "./types";

const COUNTRY_NAMES: Record<string, string> = {
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
  CANADA: "CA",
  "UNITED KINGDOM": "GB",
  JAPAN: "JP",
  FRANCE: "FR",
  GERMANY: "DE",
  SWITZERLAND: "CH",
  NETHERLANDS: "NL",
  AUSTRALIA: "AU",
  DENMARK: "DK",
  SWEDEN: "SE",
  SPAIN: "ES",
  ITALY: "IT",
  "HONG KONG": "HK",
  SINGAPORE: "SG",
  FINLAND: "FI",
  BELGIUM: "BE",
  NORWAY: "NO",
  IRELAND: "IE",
  ISRAEL: "IL",
  "NEW ZEALAND": "NZ",
  AUSTRIA: "AT",
  PORTUGAL: "PT",
  CHINA: "CN",
  TAIWAN: "TW",
  INDIA: "IN",
  KOREA: "KR",
  "KOREA (SOUTH)": "KR",
  "SOUTH KOREA": "KR",
  BRAZIL: "BR",
  "SAUDI ARABIA": "SA",
  "SOUTH AFRICA": "ZA",
  MEXICO: "MX",
  INDONESIA: "ID",
  THAILAND: "TH",
  MALAYSIA: "MY",
  "UNITED ARAB EMIRATES": "AE",
  POLAND: "PL",
  QATAR: "QA",
  KUWAIT: "KW",
  TURKEY: "TR",
  PHILIPPINES: "PH",
  CHILE: "CL",
  GREECE: "GR",
  PERU: "PE",
  HUNGARY: "HU",
  COLOMBIA: "CO",
  "CZECH REPUBLIC": "CZ",
  EGYPT: "EG",
  LUXEMBOURG: "LU",
};

/** Normalises a country name or code to ISO alpha-2; returns undefined for blanks and "-". */
export function normaliseCountry(value?: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toUpperCase();
  if (!v || v === "-" || v === "N/A") return undefined;
  if (/^[A-Z]{2}$/.test(v)) return v;
  return COUNTRY_NAMES[v];
}

/** Strips punctuation so "BRK.B", "BRK/B" and "BRKB" compare equal. */
export function normaliseTicker(value?: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v && v !== "NA" ? v : undefined;
}

const SUFFIXES = new Set([
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COS",
  "COMPANY",
  "COMPANIES",
  "LTD",
  "LIMITED",
  "PLC",
  "AG",
  "SA",
  "NV",
  "SE",
  "SPA",
  "ASA",
  "AB",
  "OYJ",
  "ABP",
  "KGAA",
  "SAB",
  "BHD",
  "TBK",
  "PCL",
  "LP",
  "LLC",
  "THE",
  "AND",
  "HOLDING",
  "HOLDINGS",
  "GROUP",
  "INTL",
  "INTERNATIONAL",
  "TRUST",
  "REIT",
]);

const CLASS_MARKER = /\b(?:CLASS|CL)\s+([A-Z])\b/;
// N-PORT titles abbreviate the class as a trailing "-A": "ALPHABET INC-A", "BERKSHIRE HATH-B".
// "-W" (weighted voting rights, as in "BABA-W") marks a Hong Kong listing, not a class.
const TITLE_CLASS = /-([A-VX-Z])$/;
const TITLE_MARKER = /-S?W$/;
// iShares writes some classes as a bare trailing letter: "CHINA CONSTRUCTION BANK CORP H".
const TRAILING_CLASS = /\s([A-Z])$/;

export interface NameParts {
  /** Comparable issuer name: suffixes, punctuation and spaces removed, plurals folded. */
  base: string;
  /** Share class letter, or "" when the name carries none. */
  shareClass: string;
}

/**
 * Splits a security name into a comparable base and a share class, so that
 * iShares' "ALPHABET CLASS A", N-PORT's "Alphabet Inc" titled "ALPHABET INC-A",
 * and "Alphabet Inc - Class A" all agree, while class C stays distinct.
 *
 * Tuned on live ITOT vs VTI and XEQT vs VEQT data (98% and 97% of weight matched).
 */
export function splitName(value: string, { trailingClass = true } = {}): NameParts {
  let v = value.toUpperCase().trim();
  v = v.replace(/\/[A-Z]{1,4}$/, ""); // "TJX COS INC/THE", "BLACKROCK FUNDING INC/DE"
  let shareClass = "";
  const marker = v.match(CLASS_MARKER);
  if (marker) {
    shareClass = marker[1];
    v = v.replace(CLASS_MARKER, " ");
  } else if (TITLE_CLASS.test(v)) {
    shareClass = v.match(TITLE_CLASS)![1];
    v = v.replace(TITLE_CLASS, "");
  } else if (TITLE_MARKER.test(v)) {
    v = v.replace(TITLE_MARKER, "");
  } else if (trailingClass && v.length < TRUNCATED_AT && TRAILING_CLASS.test(v)) {
    // Only on names short enough not to be truncated, where a final "I" may be half of "INC".
    shareClass = v.match(TRAILING_CLASS)![1];
    v = v.replace(TRAILING_CLASS, "");
  }
  v = v.replace(/'/g, "").replace(/&/g, " ").replace(/[^A-Z0-9 ]/g, " ");
  const words = v
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w))
    .map((w) => (w.length > 3 && w.endsWith("S") ? w.slice(0, -1) : w));
  return { base: words.join(""), shareClass };
}

/** US and Canadian ISINs embed the CUSIP in characters 3 to 11. */
export function cusipFromIsin(isin?: string): string | undefined {
  if (!isin || isin.length !== 12) return undefined;
  const cc = isin.slice(0, 2);
  return cc === "US" || cc === "CA" ? isin.slice(2, 11) : undefined;
}

type StrongKind = "isin" | "cusip" | "tk";

interface StrongId {
  kind: StrongKind;
  value: string;
  /**
   * Where two different values prove two different securities. ISINs and
   * CUSIPs are global; tickers only within one issuer's scheme, since iShares
   * lists DBS as "D05" and Vanguard as "DBS".
   */
  scope: string;
}

interface Identifiers {
  strong: StrongId[];
  names: string[];
}

// Sources disagree on whether Hong Kong-listed and Cayman-incorporated Chinese
// companies are "CN", "HK" or "KY", so names are compared within one bucket.
const COUNTRY_BUCKETS: Record<string, string> = { HK: "CN", KY: "CN", MO: "CN" };
const countryKey = (c?: string) => (c ? (COUNTRY_BUCKETS[c] ?? c) : "");

/** iShares truncates names to about 34 characters, often mid-word. */
const TRUNCATED_AT = 32;

export function identifiersFor(h: Holding): Identifiers {
  const strong: Identifiers["strong"] = [];
  const isin = h.isin?.trim().toUpperCase();
  if (isin && isin.length === 12) strong.push({ kind: "isin", value: isin, scope: "isin" });
  const cusip = h.cusip?.trim().toUpperCase() || cusipFromIsin(isin);
  if (cusip && cusip.length === 9 && cusip !== "000000000") strong.push({ kind: "cusip", value: cusip, scope: "cusip" });
  const ticker = normaliseTicker(h.ticker);
  if (ticker && h.country) {
    strong.push({ kind: "tk", value: `${ticker}|${countryKey(h.country)}`, scope: `tk:${h.tickerScheme ?? "any"}` });
  }

  // A truncated name also gets a key without its cut-off last word.
  const truncated = [h.name, h.altName].filter(
    (n): n is string => Boolean(n) && n!.length >= TRUNCATED_AT && n!.includes(" "),
  );
  const parts = [
    splitName(h.name),
    // Alternative names are N-PORT titles cut to 16 characters ("AMERICAN TOWER C"),
    // so a final lone letter there is a fragment, not a share class.
    ...(h.altName ? [splitName(h.altName, { trailingClass: false })] : []),
    ...truncated.map((n) => splitName(n.slice(0, n.lastIndexOf(" ")), { trailingClass: false })),
  ];
  const shareClass = parts.find((p) => p.shareClass)?.shareClass ?? "";
  const country = countryKey(h.country);
  const names = new Set<string>();
  for (const p of parts) {
    if (!p.base) continue;
    names.add(`${p.base}|${shareClass}|${country}`);
    // Sources often omit "Class A" on single-class issuers that others label.
    if (!shareClass) names.add(`${p.base}|A|${country}`);
  }
  return { strong, names: Array.from(names) };
}

/**
 * Groups rows that refer to the same security, across sources that identify
 * securities differently (iShares: ticker; N-PORT: CUSIP/ISIN; both: name).
 *
 * Rows join a group when they share any identifier. Two groups never merge if
 * they carry conflicting strong identifiers in the same scope (two different
 * CUSIPs, or two different tickers from the same issuer), which keeps share
 * classes like GOOGL and GOOG apart even when a source gives both the same
 * issuer name.
 *
 * Returns a group index per input row.
 */
export function resolveEntities(rows: Holding[]): number[] {
  const parent = rows.map((_, i) => i);
  const strongSets: Map<string, Set<string>>[] = rows.map(() => new Map());
  const owner = new Map<string, number>();

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const conflicts = (a: number, b: number): boolean => {
    const sa = strongSets[a];
    const sb = strongSets[b];
    for (const [kind, valuesA] of Array.from(sa.entries())) {
      const valuesB = sb.get(kind);
      if (!valuesB || valuesB.size === 0 || valuesA.size === 0) continue;
      let shared = false;
      valuesA.forEach((v) => {
        if (valuesB.has(v)) shared = true;
      });
      if (!shared) return true;
    }
    return false;
  };

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb || conflicts(ra, rb)) return;
    parent[rb] = ra;
    strongSets[rb].forEach((values, kind) => {
      const target = strongSets[ra].get(kind) ?? new Set<string>();
      values.forEach((v) => target.add(v));
      strongSets[ra].set(kind, target);
    });
  };

  const ids = rows.map(identifiersFor);
  ids.forEach((id, i) => {
    for (const s of id.strong) {
      const set = strongSets[i].get(s.scope) ?? new Set<string>();
      set.add(s.value);
      strongSets[i].set(s.scope, set);
    }
  });

  // Strong identifiers first, so name matches cannot glue groups before
  // their conflicting codes are known.
  ids.forEach((id, i) => {
    for (const s of id.strong) {
      const key = `${s.kind}:${s.value}`;
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, i);
      else union(prev, i);
    }
  });
  ids.forEach((id, i) => {
    for (const name of id.names) {
      const key = `nm:${name}`;
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, i);
      else union(prev, i);
    }
  });

  return rows.map((_, i) => find(i));
}
