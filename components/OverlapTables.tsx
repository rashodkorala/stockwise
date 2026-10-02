"use client";

import { useState } from "react";
import type { OverlapRow } from "@/lib/analytics/overlap";
import { pct } from "@/lib/format";

type Tab = "shared" | "onlyA" | "onlyB";

export default function OverlapTables({
  a,
  b,
  shared,
  onlyA,
  onlyB,
  counts,
}: {
  a: string;
  b: string;
  shared: OverlapRow[];
  onlyA: OverlapRow[];
  onlyB: OverlapRow[];
  counts: Record<Tab, number>;
}) {
  const [tab, setTab] = useState<Tab>("shared");
  const [shown, setShown] = useState(100);
  const rows = { shared, onlyA, onlyB }[tab];
  const max = Math.max(...rows.slice(0, shown).flatMap((r) => [r.weightA, r.weightB]), 1e-9);
  const labels: Record<Tab, string> = { shared: "Shared", onlyA: `Only in ${a}`, onlyB: `Only in ${b}` };

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }} role="tablist">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            className="btn-ghost"
            aria-pressed={tab === t}
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setShown(100);
            }}
          >
            {labels[t]} ({counts[t].toLocaleString()})
          </button>
        ))}
        {tab === "shared" && (
          <span className="legend" style={{ marginLeft: "auto" }}>
            <span>
              <span className="swatch" style={{ background: "var(--series-1)" }} />
              {a}
            </span>
            <span>
              <span className="swatch" style={{ background: "var(--series-2)" }} />
              {b}
            </span>
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Sector</th>
              <th className="num">{a}</th>
              <th className="num">{b}</th>
              {tab === "shared" && <th className="num">Overlap</th>}
              {tab === "shared" && <th style={{ width: 180 }}>Weights</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r, i) => (
              <tr key={`${r.ticker ?? r.name}-${i}`}>
                <td className="tk">{r.ticker ?? "-"}</td>
                <td className="truncate" title={r.name}>
                  {r.name}
                </td>
                <td className="muted">{r.sector ?? "-"}</td>
                <td className="num">{r.weightA ? pct(r.weightA, 3) : "-"}</td>
                <td className="num">{r.weightB ? pct(r.weightB, 3) : "-"}</td>
                {tab === "shared" && <td className="num">{pct(Math.min(r.weightA, r.weightB), 3)}</td>}
                {tab === "shared" && (
                  <td>
                    <div style={{ display: "grid", gap: 2 }} aria-hidden>
                      <div style={{ height: 5, width: `${(r.weightA / max) * 100}%`, background: "var(--series-1)", borderRadius: "0 3px 3px 0" }} />
                      <div style={{ height: 5, width: `${(r.weightB / max) * 100}%`, background: "var(--series-2)", borderRadius: "0 3px 3px 0" }} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setShown((s) => s + 200)}>
          Show more ({(rows.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}
