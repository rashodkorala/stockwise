/**
 * Downloads live holdings files.
 *
 *   pnpm snapshot            full files into fixtures/live/ (gitignored) for STOCKWISE_FIXTURES=live
 *   pnpm snapshot --excerpt also rewrites the committed excerpts in fixtures/holdings/
 *
 * Excerpts keep each file's real metadata and header with its largest rows, so
 * parser tests run against the genuine formats without committing full files.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { fetchSec, fetchText } from "../lib/http";
import { nportDocumentUrl } from "../lib/sources/edgarNport";
import { discoverIshares, holdingsUrl } from "../lib/sources/ishares";
import { lookupRegistry } from "../lib/sources/registry";
import { fetchVanguardPayload, vanguardPortIds, type VanguardPayload } from "../lib/sources/vanguard";

type Kind = "ishares-ca" | "ishares-us" | "vanguard-ca" | "nport";

const FUNDS: { ticker: string; kind: Kind }[] = [
  { ticker: "XEQT", kind: "ishares-ca" },
  { ticker: "XTOT", kind: "ishares-ca" },
  { ticker: "XIC", kind: "ishares-ca" },
  { ticker: "XIU", kind: "ishares-ca" },
  { ticker: "XEF", kind: "ishares-ca" },
  { ticker: "XEC", kind: "ishares-ca" },
  { ticker: "ITOT", kind: "ishares-us" },
  { ticker: "IEFA", kind: "ishares-us" },
  { ticker: "IEMG", kind: "ishares-us" },
  { ticker: "VTI", kind: "nport" },
  { ticker: "VEQT", kind: "vanguard-ca" },
  { ticker: "VUN", kind: "vanguard-ca" },
  { ticker: "VCN", kind: "vanguard-ca" },
  { ticker: "VIU", kind: "vanguard-ca" },
  { ticker: "VEE", kind: "vanguard-ca" },
  { ticker: "VWO", kind: "nport" },
];

const extension = (kind: Kind) => (kind === "nport" ? "xml" : kind === "vanguard-ca" ? "vanguard.json" : "csv");
const EXCERPT_ROWS = 40;
const LOOKTHROUGH_ROWS = 60;

const root = path.join(__dirname, "..", "fixtures");

async function download(f: (typeof FUNDS)[number]): Promise<string> {
  if (f.kind === "nport") return fetchSec(await nportDocumentUrl(f.ticker), 60_000);
  if (f.kind === "vanguard-ca") {
    const portId = (await vanguardPortIds())[f.ticker];
    if (!portId) throw new Error(`${f.ticker} is not a Vanguard Canada ETF`);
    return JSON.stringify(await fetchVanguardPayload(portId), null, 1);
  }
  const region = f.kind === "ishares-ca" ? "ca" : "us";
  const product = lookupRegistry(f.ticker)?.ishares ?? (await discoverIshares(region, f.ticker));
  return fetchText(holdingsUrl(region, f.ticker, product), { timeoutMs: 60_000 });
}

/** Keeps metadata, then the top rows of each holdings table, then the trailing disclaimer. */
export function excerptCsv(csv: string): string {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const out: string[] = [];
  let table = 0;
  let inTable = false;
  let kept = 0;
  for (const line of lines) {
    const first = Papa.parse<string[]>(line).data[0]?.[0]?.trim() ?? "";
    if (first === "Ticker") {
      inTable = true;
      kept = 0;
      table++;
      out.push(line);
      continue;
    }
    if (inTable) {
      const isRow = line.includes(",") && first !== "";
      if (!isRow) {
        inTable = false;
        out.push(line);
        continue;
      }
      if (kept++ < (table === 1 ? EXCERPT_ROWS : LOOKTHROUGH_ROWS)) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Keeps the fund profile and its largest rows by weight. */
export function excerptVanguard(json: string): string {
  const payload = JSON.parse(json) as VanguardPayload;
  const items = [...payload.items]
    .sort((a, b) => (b.marketValuePercentage ?? 0) - (a.marketValuePercentage ?? 0))
    .slice(0, EXCERPT_ROWS);
  return JSON.stringify({ ...payload, items }, null, 1);
}

/** Keeps the filing's header and its largest positions by weight. */
export function excerptNport(xml: string): string {
  const open = xml.indexOf("<invstOrSec>");
  const close = xml.lastIndexOf("</invstOrSec>") + "</invstOrSec>".length;
  const blocks = xml.slice(open, close).split(/(?=<invstOrSec>)/).map((b) => b.trim());
  const pct = (b: string) => Number(b.match(/<pctVal>([^<]*)/)?.[1] ?? 0);
  const top = blocks.sort((a, b) => pct(b) - pct(a)).slice(0, EXCERPT_ROWS);
  return `${xml.slice(0, open)}${top.join("\n      ")}${xml.slice(close)}`;
}

async function main() {
  const excerpt = process.argv.includes("--excerpt");
  await mkdir(path.join(root, "live"), { recursive: true });
  for (const f of FUNDS) {
    const ext = extension(f.kind);
    try {
      const body = await download(f);
      await writeFile(path.join(root, "live", `${f.ticker}.${ext}`), body);
      if (excerpt) {
        const short = ext === "xml" ? excerptNport(body) : ext === "vanguard.json" ? excerptVanguard(body) : excerptCsv(body);
        await writeFile(path.join(root, "holdings", `${f.ticker}.${ext}`), short);
      }
      console.log(`${f.ticker.padEnd(5)} ${(body.length / 1024).toFixed(0).padStart(6)} KB`);
    } catch (err) {
      console.error(`${f.ticker.padEnd(5)} failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main();
