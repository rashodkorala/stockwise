# Stockwise

A Bloomberg-style terminal for looking *through* your ETFs to the companies you actually own.

- **X-ray a fund** (`XEQT <GO>`): every underlying security, expanding funds of funds (XEQT → XTOT, ITOT, XIC, XEF, XEC → stocks), with a treemap, sector and country breakdowns, and a "held via" path for each name.
- **Overlap** (`ITOT VTI OVLP <GO>`): weighted overlap, shared holdings with both weights, and what is unique to each fund.
- **Portfolio** (`PORT <GO>`): enter units or market values to see your total exposure to each company across every fund and stock you hold, plus a fund-overlap matrix. Saved on this computer.

## Data sources

| Source | Covers | Notes |
| --- | --- | --- |
| BlackRock Canada / iShares US holdings CSVs | iShares funds (XEQT, XIC, ITOT, IVV…) | Daily. Product pages are discovered from the iShares screeners when not listed in `lib/sources/registry.ts`. Weights are derived from exact market values because the published weight column is rounded to 0.01%. |
| SEC EDGAR N-PORT | Any US-registered fund (VTI, VOO, SCHD, QQQ…) | Quarterly, public ~60 days after quarter end. SPY, a unit trust, files none. |
| Financial Modeling Prep (optional) | Fallback for everything else (Vanguard Canada such as VEQT, BMO, SPY) | Paid; set `FMP_API_KEY`. |
| Yahoo Finance chart endpoint | Prices and CAD/USD for positions entered as units | Unofficial; falls back to FMP when a key is set. |

Securities are matched across sources by ISIN, CUSIP, ticker + country, then a normalised name plus share class (`lib/identity.ts`). N-PORT rows rarely carry tickers, so names do most of the work: on live data, 97.5% of ITOT's weight matches VTI's filing.

BlackRock Canada files for funds of funds also publish BlackRock's own look-through. The ETF page compares ours against it: for XEQT, all of BlackRock's 500 largest names match to within 0.004 percentage points.

## Install and run

Stockwise runs as a small app on your own computer. You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/rashodkorala/stockwise
cd stockwise
npm install
cp .env.example .env.local    # Windows: copy .env.example .env.local; then set SEC_USER_AGENT
npm run app
```

`npm run app` builds the app the first time (about a minute), starts it at http://localhost:3000, and opens your browser. Press Ctrl+C to stop it. It only listens on this computer, not your network. `npm run dev` runs it with live reload while you change code.

### Your data

- `data/portfolio.json`: your saved portfolio.
- `data/cache/`: downloaded fund holdings (kept 12 to 24 hours), so restarts are fast.

Delete `data/` to start fresh. Set `STOCKWISE_DATA_DIR` to keep it elsewhere.

### Offline modes

- `npm run dev:sample` serves the committed excerpts in `fixtures/holdings/`: real files trimmed to each fund's 40 largest rows.
- `npm run snapshot`, then `STOCKWISE_FIXTURES=live npm run dev`, serves full live files saved to `fixtures/live/` (gitignored).

## Tests

```bash
npm test           # parsers, identity matching, look-through, overlap, portfolio maths (offline)
npm run test:live  # checks every live source, including XEQT against BlackRock's own look-through
npx tsc --noEmit
```

## Layout

- `lib/sources/`: holdings providers (iShares, N-PORT, FMP, sample) and `resolve.ts`, which tries them in order and reports each failure.
- `lib/analytics/`: pure look-through, overlap, and portfolio functions.
- `lib/service.ts`: server-side orchestration and the compact views sent to pages.
- `app/`: pages (`/etf/[ticker]`, `/compare`, `/portfolio`) and JSON APIs (`/api/etf/[ticker]`, `/api/overlap`, `/api/portfolio`).
- `lib/storage.ts`, `lib/cache.ts`: the saved portfolio and the on-disk fund cache under `data/`.
- `scripts/app.mjs`: the `npm run app` launcher.

## Roadmap

- **Company money flow** (`AMD FLOW`): stakes a company owns (its 13F and 13D/G filings), subsidiaries (10-K Exhibit 21), which ETFs hold it, and who owns it.
- Free institutional ownership from SEC's quarterly 13F data sets, and daily fund snapshots for "what changed".
