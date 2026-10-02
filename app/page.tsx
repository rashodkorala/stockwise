import Link from "next/link";
import { registryEntries } from "@/lib/sources/registry";

const COMMANDS: [string, string][] = [
  ["XEQT", "X-ray a fund: every company inside it, looking through funds of funds"],
  ["XEQT VEQT OVLP", "Overlap between two funds: shared holdings and what is unique to each"],
  ["PORT", "Your portfolio: total exposure to each company across all your holdings"],
  ["HELP", "This screen"],
];

export default function Home() {
  const entries = registryEntries();
  return (
    <main className="page">
      <section className="panel">
        <div className="panel-head">Commands</div>
        <div className="panel-body">
          <p className="muted" style={{ marginBottom: 12 }}>
            Type a command in the bar above and press Enter. Press <span className="tk">/</span> anywhere to jump to it.
          </p>
          <table className="data">
            <tbody>
              {COMMANDS.map(([cmd, desc]) => (
                <tr key={cmd}>
                  <td className="tk" style={{ width: 200 }}>
                    {cmd} &lt;GO&gt;
                  </td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">Try</div>
        <div className="panel-body toolbar">
          <Link className="btn-ghost" href="/etf/XEQT">
            XEQT look-through
          </Link>
          <Link className="btn-ghost" href="/compare?a=XEQT&b=VEQT">
            XEQT vs VEQT (iShares vs Vanguard)
          </Link>
          <Link className="btn-ghost" href="/compare?a=ITOT&b=VTI">
            ITOT vs VTI
          </Link>
          <Link className="btn-ghost" href="/compare?a=XIC&b=XIU">
            XIC vs XIU
          </Link>
          <Link className="btn-ghost" href="/etf/VTI">
            VTI (SEC N-PORT)
          </Link>
          <Link className="btn-ghost" href="/portfolio">
            Build a portfolio
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          Known funds <span className="muted">any US fund that files N-PORT also works</span>
        </div>
        <div className="panel-body table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Listing</th>
                <th>Free source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.ticker}>
                  <td>
                    <Link href={`/etf/${e.ticker}`} className="tk">
                      {e.ticker}
                    </Link>
                  </td>
                  <td>{e.name}</td>
                  <td className="muted">{e.country === "CA" ? "TSX" : "US"}</td>
                  <td className="muted">{e.sources.length ? e.sources.join(", ") : "paid fallback only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
