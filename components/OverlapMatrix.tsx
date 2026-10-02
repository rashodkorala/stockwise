import { pct } from "@/lib/format";

// Sequential blue ramp stepped for the dark surface: more overlap reads brighter.
const BINS = [
  { upTo: 0.2, fill: "#184f95", ink: "var(--text-primary)" },
  { upTo: 0.4, fill: "#256abf", ink: "var(--text-primary)" },
  { upTo: 0.6, fill: "#3987e5", ink: "var(--text-primary)" },
  { upTo: 0.8, fill: "#6da7ec", ink: "#0b0b0b" },
  { upTo: 1.01, fill: "#9ec5f4", ink: "#0b0b0b" },
];
const binFor = (v: number) => BINS.find((b) => v < b.upTo) ?? BINS[BINS.length - 1];

export default function OverlapMatrix({ tickers, values }: { tickers: string[]; values: number[][] }) {
  if (tickers.length < 2) return <p className="muted">Add two or more funds to see how much they overlap.</p>;
  return (
    <div>
      <div className="table-wrap">
        <table className="data" style={{ width: "auto" }}>
          <thead>
            <tr>
              <th />
              {tickers.map((t) => (
                <th key={t} className="num">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((row, i) => (
              <tr key={row}>
                <th className="tk" style={{ position: "static" }}>
                  {row}
                </th>
                {tickers.map((col, j) => {
                  if (i === j) return <td key={col} className="num muted">-</td>;
                  const v = values[i][j];
                  const bin = binFor(v);
                  return (
                    <td
                      key={col}
                      className="num"
                      title={`${row} and ${col} overlap ${pct(v, 1)}`}
                      style={{ background: bin.fill, color: bin.ink, borderBottom: "2px solid var(--surface-1)", borderRight: "2px solid var(--surface-1)" }}
                    >
                      <a href={`/compare?a=${encodeURIComponent(row)}&b=${encodeURIComponent(col)}`} style={{ color: "inherit" }}>
                        {pct(v, 0)}
                      </a>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {BINS.map((b, i) => (
          <span key={b.fill}>
            <span className="swatch" style={{ background: b.fill }} />
            {i * 20}-{Math.min(100, (i + 1) * 20)}%
          </span>
        ))}
      </div>
    </div>
  );
}
