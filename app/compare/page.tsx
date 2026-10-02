import Link from "next/link";
import OverlapTables from "@/components/OverlapTables";
import { LoadError } from "@/components/SourceNotice";
import { pct } from "@/lib/format";
import { loadOverlap } from "@/lib/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overlap · Stockwise" };

function CompareForm({ a = "", b = "" }: { a?: string; b?: string }) {
  return (
    <form action="/compare" className="toolbar">
      <input className="input" name="a" defaultValue={a} placeholder="XEQT" aria-label="First ticker" required />
      <span className="muted">vs</span>
      <input className="input" name="b" defaultValue={b} placeholder="VTI" aria-label="Second ticker" required />
      <button className="btn" type="submit">
        OVLP
      </button>
    </form>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: { a?: string; b?: string } }) {
  const a = searchParams.a?.trim().toUpperCase();
  const b = searchParams.b?.trim().toUpperCase();
  if (!a || !b) {
    return (
      <main className="page">
        <section className="panel">
          <div className="panel-head">Fund overlap</div>
          <div className="panel-body">
            <p className="muted" style={{ marginBottom: 12 }}>
              Compares two funds security by security after looking through any funds they hold.
            </p>
            <CompareForm />
          </div>
        </section>
      </main>
    );
  }

  const result = await loadOverlap(a, b);
  if (!result.ok) {
    return (
      <main className="page">
        <CompareForm a={a} b={b} />
        <LoadError title={`${a} vs ${b}`} error={result.error} attempts={result.attempts} />
      </main>
    );
  }
  const o = result.data;

  return (
    <main className="page">
      <div className="title-row">
        <h1>
          <Link href={`/etf/${encodeURIComponent(a)}`}>{a}</Link> vs <Link href={`/etf/${encodeURIComponent(b)}`}>{b}</Link>
        </h1>
        <span className="meta">
          {o.a.name} · {o.b.name}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <CompareForm a={a} b={b} />
        </span>
      </div>

      <section className="panel">
        <div className="panel-body stats" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="stat-label">Weighted overlap</div>
            <div className="stat-hero">{pct(o.overlap, 1)}</div>
          </div>
          <div>
            <div className="stat-label">Shared securities</div>
            <div className="stat-value">{o.sharedCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="stat-label">
              {a} held by {b}
            </div>
            <div className="stat-value">{pct(o.aInB, 1)}</div>
          </div>
          <div>
            <div className="stat-label">
              {b} held by {a}
            </div>
            <div className="stat-value">{pct(o.bInA, 1)}</div>
          </div>
          <div>
            <div className="stat-label">Securities</div>
            <div className="stat-value">
              {o.a.count.toLocaleString()} / {o.b.count.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="panel-body meta" style={{ borderTop: "1px solid var(--rule)" }}>
          Weighted overlap adds up the smaller of the two weights for every security both funds hold, after rescaling each fund to
          100% of its non-cash holdings. 100% means identical portfolios.
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">Holdings</div>
        <div className="panel-body">
          <OverlapTables
            a={a}
            b={b}
            shared={o.shared}
            onlyA={o.onlyA}
            onlyB={o.onlyB}
            counts={{ shared: o.sharedCount, onlyA: o.onlyACount, onlyB: o.onlyBCount }}
          />
        </div>
      </section>
    </main>
  );
}
