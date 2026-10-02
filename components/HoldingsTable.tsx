"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { money, pct } from "@/lib/format";
import type { ExposureRow } from "@/lib/service";

type Row = ExposureRow & { value?: number };
type SortKey = "weight" | "name" | "sector" | "country";

export default function HoldingsTable({
  rows,
  total,
  currency,
}: {
  rows: Row[];
  /** Total number of exposures, when `rows` is a truncated list. */
  total: number;
  /** When set, a value column is shown in this currency. */
  currency?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("weight");
  const [shown, setShown] = useState(100);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = q
      ? rows.filter((r) => r.name.toUpperCase().includes(q) || r.ticker?.toUpperCase().includes(q) || r.sector?.toUpperCase().includes(q))
      : rows;
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      weight: (a, b) => b.weight - a.weight,
      name: (a, b) => a.name.localeCompare(b.name),
      sector: (a, b) => (a.sector ?? "~").localeCompare(b.sector ?? "~") || b.weight - a.weight,
      country: (a, b) => (a.country ?? "~").localeCompare(b.country ?? "~") || b.weight - a.weight,
    };
    return [...list].sort(cmp[sort]);
  }, [rows, query, sort]);

  const head = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort === key ? (key === "weight" ? "descending" : "ascending") : undefined}>
      <button onClick={() => setSort(key)}>
        {label}
        {sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Filter by name, ticker, sector"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(100);
          }}
          aria-label="Filter holdings"
        />
        <span className="muted">
          {filtered.length.toLocaleString()} shown
          {total > rows.length ? ` of ${total.toLocaleString()} (top ${rows.length.toLocaleString()} loaded)` : ""}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Ticker</th>
              {head("name", "Name")}
              {head("sector", "Sector")}
              {head("country", "Ctry")}
              {currency && <th className="num">Value</th>}
              {head("weight", "Weight", "num")}
              <th>Held via</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map((r, i) => (
              <tr key={`${r.ticker ?? r.name}-${i}`}>
                <td className="num muted">{i + 1}</td>
                <td className="tk">{r.ticker ?? "-"}</td>
                <td className="truncate" title={r.name}>
                  {r.name}
                </td>
                <td className="muted">{r.sector ?? (r.assetClass !== "equity" ? r.assetClass : "-")}</td>
                <td className="muted">{r.country ?? "-"}</td>
                {currency && <td className="num">{money(r.value ?? 0, currency)}</td>}
                <td className="num">{pct(r.weight, 3)}</td>
                <td className="muted">
                  {r.via.map((v, j) => (
                    <span key={v}>
                      {j > 0 && ", "}
                      {v === "" && "Held directly"}
                      {v.split(" › ").filter(Boolean).map((t, k) => (
                        <span key={k}>
                          {k > 0 && " › "}
                          <Link href={`/etf/${encodeURIComponent(t)}`}>{t}</Link>
                        </span>
                      ))}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shown && (
        <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setShown((s) => s + 200)}>
          Show more ({(filtered.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}
