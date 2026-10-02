import Link from "next/link";
import BarList from "@/components/BarList";
import HoldingsTable from "@/components/HoldingsTable";
import { FundSources, LoadError } from "@/components/SourceNotice";
import Treemap from "@/components/Treemap";
import { pct, SOURCE_LABELS } from "@/lib/format";
import { loadLookThrough, toEtfView } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { ticker: string } }) {
  return { title: `${decodeURIComponent(params.ticker).toUpperCase()} · Stockwise` };
}

export default async function EtfPage({ params }: { params: { ticker: string } }) {
  const symbol = decodeURIComponent(params.ticker).toUpperCase();
  const result = await loadLookThrough(symbol);
  if (!result.ok) {
    return (
      <main className="page">
        <LoadError title={symbol} error={result.error} attempts={result.attempts} />
        <p className="muted">
          If {symbol} is a single company rather than a fund, add it on the <Link href="/portfolio">portfolio</Link> page; the
          company money-flow view arrives in the next phase.
        </p>
      </main>
    );
  }

  const v = toEtfView(result.data);
  const expandedFunds = new Set(v.funds.filter((f) => !f.error).map((f) => f.ticker)).size - 1;
  const top10 = v.exposures.slice(0, 10).reduce((s, e) => s + e.weight, 0);

  return (
    <main className="page">
      <div className="title-row">
        <h1>{v.ticker}</h1>
        <span className="name">{v.name}</span>
        <span className="meta">
          as of {v.asOf} · {SOURCE_LABELS[v.source] ?? v.source}
        </span>
      </div>

      <FundSources funds={v.funds} />
      {v.coverage < 0.97 && v.coverage > 0 && (
        <div className="notice">
          The holdings files list {pct(v.coverage, 1)} of this fund&apos;s weight; the rest is not itemised by the source.
        </div>
      )}

      {v.issuerCheck && (
        <div className={v.issuerCheck.maxDiff <= 0.001 ? "notice" : "notice error"}>
          Cross-check: the issuer publishes its own look-through ({v.issuerCheck.issuerCount.toLocaleString()} securities). Of its{" "}
          {v.issuerCheck.compared} largest names we found {v.issuerCheck.found}, with weights differing by at most{" "}
          {(v.issuerCheck.maxDiff * 100).toFixed(3)} pp
          {v.issuerCheck.worst && v.issuerCheck.maxDiff > 0.0001 ? ` (largest gap: ${v.issuerCheck.worst.ticker})` : ""}.
        </div>
      )}

      <section className="panel">
        <div className="panel-body stats">
          <div>
            <div className="stat-label">Direct holdings</div>
            <div className="stat-value">{v.direct.length.toLocaleString()}</div>
          </div>
          <div>
            <div className="stat-label">Underlying securities</div>
            <div className="stat-value">{v.exposureCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="stat-label">Funds looked through</div>
            <div className="stat-value">{expandedFunds}</div>
          </div>
          <div>
            <div className="stat-label">Top 10 weight</div>
            <div className="stat-value">{pct(top10, 1)}</div>
          </div>
          <form action="/compare" className="toolbar" style={{ marginLeft: "auto" }}>
            <input type="hidden" name="a" value={v.ticker} />
            <input className="input" name="b" placeholder="Compare with…" aria-label="Compare with ticker" required />
            <button className="btn" type="submit">
              OVLP
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">Look-through map</div>
        <div className="panel-body">
          <Treemap data={v.treemap} />
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">Direct holdings</div>
          <div className="panel-body table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {v.direct.slice(0, 200).map((d, i) => (
                  <tr key={i}>
                    <td>
                      {d.isFund && d.ticker ? (
                        <Link className="tk" href={`/etf/${encodeURIComponent(d.ticker)}`}>
                          {d.ticker}
                        </Link>
                      ) : (
                        <span className="tk">{d.ticker ?? "-"}</span>
                      )}
                    </td>
                    <td className="truncate" title={d.name}>
                      {d.name}
                      {d.isFund && <span className="muted">{d.expanded ? " · looked through" : " · not expanded"}</span>}
                    </td>
                    <td className="num">{pct(d.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">Sectors (equities)</div>
          <div className="panel-body">
            <BarList items={v.sectors} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">Countries (equities)</div>
          <div className="panel-body">
            <BarList items={v.countries} />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">All underlying holdings</div>
        <div className="panel-body">
          <HoldingsTable rows={v.exposures} total={v.exposureCount} />
        </div>
      </section>
    </main>
  );
}
