"use client";

import { Authenticator, ThemeProvider, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { useCallback, useEffect, useState } from "react";
import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";
import BarList from "@/components/BarList";
import HoldingsTable from "@/components/HoldingsTable";
import OverlapMatrix from "@/components/OverlapMatrix";
import { money, pct } from "@/lib/format";
import type { PortfolioView } from "@/lib/service";

// amplify_outputs.json is written by `npx ampx sandbox` or the Amplify pipeline.
// Without it (a placeholder {} from scripts/ensure-amplify-outputs.mjs), the
// app runs with accounts switched off and saves portfolios in the browser.
const accountsEnabled = Boolean((outputs as Record<string, unknown>).auth);
if (accountsEnabled) Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

let client: ReturnType<typeof generateClient<Schema>> | undefined;
const dataClient = () => (client ??= generateClient<Schema>());

interface AuthState {
  status: "configuring" | "authenticated" | "unauthenticated" | "disabled";
  loginId?: string;
  signOut?: () => void;
}

interface Position {
  ticker: string;
  units: string;
  marketValue: string;
  currency: "CAD" | "USD";
}

const GUEST_KEY = "stockwise.portfolio";
const EMPTY: Position = { ticker: "", units: "", marketValue: "", currency: "CAD" };
const DEMO: Position[] = [
  { ticker: "XEQT", units: "250", marketValue: "", currency: "CAD" },
  { ticker: "VTI", units: "", marketValue: "5000", currency: "USD" },
  { ticker: "AAPL", units: "10", marketValue: "", currency: "USD" },
];

const toNumber = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

function readGuest(): { positions: Position[]; base: "CAD" | "USD" } | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeGuest(positions: Position[], base: "CAD" | "USD") {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify({ positions, base }));
  } catch {
    // Private mode or blocked storage: the portfolio just won't persist.
  }
}

function Portfolio({ auth }: { auth: AuthState }) {
  const authStatus = auth.status;
  const signedIn = authStatus === "authenticated";
  const [showSignIn, setShowSignIn] = useState(false);
  const [positions, setPositions] = useState<Position[]>([EMPTY]);
  const [base, setBase] = useState<"CAD" | "USD">("CAD");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<PortfolioView | null>(null);
  const [loading, setLoading] = useState(false);

  // Load from the account when signed in, otherwise from this browser.
  useEffect(() => {
    if (authStatus === "configuring") return;
    if (!signedIn) {
      const g = readGuest();
      if (g) {
        setPositions(g.positions.length ? g.positions : [EMPTY]);
        setBase(g.base);
      }
      setRecordId(null);
      return;
    }
    setShowSignIn(false);
    dataClient().models.Portfolio.list().then(({ data, errors }) => {
      if (errors?.length) return setStatus(`Could not load your portfolio: ${errors[0].message}`);
      const p = data[0];
      if (!p) return;
      setRecordId(p.id);
      setBase(p.baseCurrency === "USD" ? "USD" : "CAD");
      const saved = (p.positions ?? []).filter(Boolean).map((x) => ({
        ticker: x!.ticker,
        units: x!.units?.toString() ?? "",
        marketValue: x!.marketValue?.toString() ?? "",
        currency: (x!.currency === "USD" ? "USD" : "CAD") as Position["currency"],
      }));
      if (saved.length) setPositions(saved);
    });
  }, [authStatus, signedIn]);

  const update = (i: number, patch: Partial<Position>) =>
    setPositions((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const valid = positions.filter((p) => p.ticker.trim() && (toNumber(p.units) || toNumber(p.marketValue)));

  const save = useCallback(async () => {
    if (!signedIn) {
      writeGuest(positions, base);
      setStatus("Saved in this browser. Sign in to keep it across devices.");
      return;
    }
    const payload = {
      name: "My portfolio",
      baseCurrency: base,
      positions: valid.map((p) => ({
        ticker: p.ticker.trim().toUpperCase(),
        units: toNumber(p.units),
        marketValue: toNumber(p.marketValue),
        currency: p.currency,
      })),
    };
    const { data, errors } = recordId
      ? await dataClient().models.Portfolio.update({ id: recordId, ...payload })
      : await dataClient().models.Portfolio.create(payload);
    if (errors?.length || !data) return setStatus(`Save failed: ${errors?.[0]?.message ?? "unknown error"}`);
    setRecordId(data.id);
    setStatus("Saved to your account.");
  }, [signedIn, positions, base, valid, recordId]);

  async function analyse() {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseCurrency: base,
          positions: valid.map((p) => ({
            ticker: p.ticker,
            units: toNumber(p.units),
            marketValue: toNumber(p.marketValue),
            currency: p.currency,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setView(body);
    } catch (err) {
      setStatus(`Analysis failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-head">
          <span>Holdings</span>
          <span className="toolbar">
            {authStatus === "disabled" ? (
              <span className="muted">Accounts off: saving to this browser (run npx ampx sandbox to enable sign-in)</span>
            ) : signedIn ? (
              <>
                <span className="muted">{auth.loginId}</span>
                <button className="btn-ghost" onClick={auth.signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <button className="btn-ghost" onClick={() => setShowSignIn((s) => !s)}>
                {showSignIn ? "Cancel" : "Sign in to sync"}
              </button>
            )}
          </span>
        </div>
        {showSignIn && !signedIn && (
          <div className="panel-body" style={{ borderBottom: "1px solid var(--rule)" }}>
            <ThemeProvider colorMode="dark">
              <Authenticator />
            </ThemeProvider>
          </div>
        )}
        <div className="panel-body">
          <p className="muted" style={{ marginBottom: 12 }}>
            Enter each holding as units (priced live) or as a market value. Funds are looked through to their companies; anything
            else is treated as a single stock. Add <span className="tk">.TO</span> for TSX stocks that are not in the fund list.
          </p>
          <div className="table-wrap">
            <table className="data" style={{ width: "auto" }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="num">Units</th>
                  <th className="num">or Market value</th>
                  <th>Currency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="input"
                        style={{ width: 110, textTransform: "uppercase" }}
                        value={p.ticker}
                        onChange={(e) => update(i, { ticker: e.target.value })}
                        placeholder="XEQT"
                        aria-label={`Ticker ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 100, textAlign: "right" }}
                        inputMode="decimal"
                        value={p.units}
                        onChange={(e) => update(i, { units: e.target.value, marketValue: "" })}
                        aria-label={`Units ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 120, textAlign: "right" }}
                        inputMode="decimal"
                        value={p.marketValue}
                        onChange={(e) => update(i, { marketValue: e.target.value, units: "" })}
                        aria-label={`Market value ${i + 1}`}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={p.currency}
                        onChange={(e) => update(i, { currency: e.target.value as Position["currency"] })}
                        aria-label={`Currency ${i + 1}`}
                      >
                        <option>CAD</option>
                        <option>USD</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn-ghost"
                        onClick={() => setPositions((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : [EMPTY]))}
                        aria-label={`Remove row ${i + 1}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => setPositions((ps) => [...ps, EMPTY])}>
              + Add holding
            </button>
            {positions.every((p) => !p.ticker) && (
              <button className="btn-ghost" onClick={() => setPositions(DEMO)}>
                Load example
              </button>
            )}
            <label className="muted">
              Base currency{" "}
              <select className="input" value={base} onChange={(e) => setBase(e.target.value as "CAD" | "USD")}>
                <option>CAD</option>
                <option>USD</option>
              </select>
            </label>
            <button className="btn-ghost" onClick={save} disabled={valid.length === 0}>
              Save
            </button>
            <button className="btn" onClick={analyse} disabled={valid.length === 0 || loading}>
              {loading ? "Analysing…" : "Analyse"}
            </button>
            {status && (
              <span className="muted" role="status">
                {status}
              </span>
            )}
          </div>
        </div>
      </section>

      {view && <Results view={view} />}
    </main>
  );
}

function Results({ view }: { view: PortfolioView }) {
  const errors = view.positions.filter((p) => p.error);
  return (
    <>
      {errors.length > 0 && (
        <div className="notice error">
          Left out of the analysis:
          <ul>
            {errors.map((p) => (
              <li key={p.ticker}>
                {p.ticker}: {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="panel">
        <div className="panel-body stats">
          <div>
            <div className="stat-label">Total value</div>
            <div className="stat-hero">{money(view.total, view.baseCurrency)}</div>
          </div>
          <div>
            <div className="stat-label">Companies owned</div>
            <div className="stat-value">{view.exposureCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="stat-label">Largest exposure</div>
            <div className="stat-value">
              {view.exposures[0] ? `${view.exposures[0].ticker ?? view.exposures[0].name} ${pct(view.exposures[0].weight, 1)}` : "-"}
            </div>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">Positions</div>
          <div className="panel-body table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {view.positions
                  .filter((p) => !p.error)
                  .map((p) => (
                    <tr key={p.ticker}>
                      <td className="tk">
                        {p.kind === "fund" ? <a href={`/etf/${encodeURIComponent(p.ticker)}`}>{p.ticker}</a> : p.ticker}
                      </td>
                      <td className="muted">{p.kind === "fund" ? "Fund" : "Stock"}</td>
                      <td className="num">{p.price ? `${p.price.toFixed(2)} ${p.priceCurrency}` : "-"}</td>
                      <td className="num">{money(p.value, view.baseCurrency)}</td>
                      <td className="num">{pct(view.total ? p.value / view.total : 0, 1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">Fund overlap</div>
          <div className="panel-body">
            <OverlapMatrix {...view.overlapMatrix} />
          </div>
        </section>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">Sectors (equities)</div>
          <div className="panel-body">
            <BarList items={view.sectors} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">Countries (equities)</div>
          <div className="panel-body">
            <BarList items={view.countries} />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">What you actually own</div>
        <div className="panel-body">
          <HoldingsTable rows={view.exposures} total={view.exposureCount} currency={view.baseCurrency} />
        </div>
      </section>
    </>
  );
}

function AccountPortfolio() {
  const { authStatus, user, signOut } = useAuthenticator((ctx) => [ctx.authStatus, ctx.user]);
  return <Portfolio auth={{ status: authStatus, loginId: user?.signInDetails?.loginId, signOut }} />;
}

export default function PortfolioClient() {
  if (!accountsEnabled) return <Portfolio auth={{ status: "disabled" }} />;
  return (
    <Authenticator.Provider>
      <AccountPortfolio />
    </Authenticator.Provider>
  );
}
