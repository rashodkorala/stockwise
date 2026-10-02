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
  "COMPANY",
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
  "LP",
  "LLC",
  "THE",
]);

/**
 * Reduces a security name to a comparable form, keeping share-class markers:
 * "Alphabet Inc - Class A" and "ALPHABET INC-CL A" both become "ALPHABET CLASS A".
 */
export function normaliseName(value: string): string {
  let v = value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bCL\b\.?/g, " CLASS ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  v = v.replace(/^THE /, "");
  const words = v.split(" ").filter((w) => !SUFFIXES.has(w));
  return words.join(" ");
}

/** US and Canadian ISINs embed the CUSIP in characters 3 to 11. */
export function cusipFromIsin(isin?: string): string | undefined {
  if (!isin || isin.length !== 12) return undefined;
  const cc = isin.slice(0, 2);
  return cc === "US" || cc === "CA" ? isin.slice(2, 11) : undefined;
}

type StrongKind = "isin" | "cusip" | "tk";

interface Identifiers {
  strong: { kind: StrongKind; value: string }[];
  name?: string;
}

export function identifiersFor(h: Holding): Identifiers {
  const strong: Identifiers["strong"] = [];
  const isin = h.isin?.trim().toUpperCase();
  if (isin && isin.length === 12) strong.push({ kind: "isin", value: isin });
  const cusip = h.cusip?.trim().toUpperCase() || cusipFromIsin(isin);
  if (cusip && cusip.length === 9 && cusip !== "000000000") strong.push({ kind: "cusip", value: cusip });
  const ticker = normaliseTicker(h.ticker);
  if (ticker && h.country) strong.push({ kind: "tk", value: `${ticker}|${h.country}` });
  const nm = normaliseName(h.name);
  return { strong, name: nm ? `${nm}|${h.country ?? ""}` : undefined };
}

/**
 * Groups rows that refer to the same security, across sources that identify
 * securities differently (iShares: ticker; N-PORT: CUSIP/ISIN; both: name).
 *
 * Rows join a group when they share any identifier. Two groups never merge if
 * they carry conflicting strong identifiers of the same kind (for example two
 * different CUSIPs), which keeps share classes like GOOGL and GOOG apart even
 * when a source gives both the same issuer name.
 *
 * Returns a group index per input row.
 */
export function resolveEntities(rows: Holding[]): number[] {
  const parent = rows.map((_, i) => i);
  const strongSets: Map<StrongKind, Set<string>>[] = rows.map(() => new Map());
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
      const set = strongSets[i].get(s.kind) ?? new Set<string>();
      set.add(s.value);
      strongSets[i].set(s.kind, set);
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
    if (!id.name) return;
    const key = `nm:${id.name}`;
    const prev = owner.get(key);
    if (prev === undefined) owner.set(key, i);
    else union(prev, i);
  });

  return rows.map((_, i) => find(i));
}
