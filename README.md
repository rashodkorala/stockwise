# Stockwise

A Bloomberg-style terminal for looking *through* your ETFs to the companies you actually own.

- **X-ray a fund** (`XEQT <GO>`): every underlying security, expanding funds of funds (XEQT → XTOT, ITOT, XIC, XEF, XEC → stocks), with a treemap, sector and country breakdowns, and a "held via" path for each name.
- **Overlap** (`ITOT VTI OVLP <GO>`): weighted overlap, shared holdings with both weights, and what is unique to each fund.
- **Portfolio** (`PORT <GO>`): enter units or market values to see your total exposure to each company across every fund and stock you hold, plus a fund-overlap matrix. Saved to your account (Amplify Cognito + DynamoDB) or, signed out, to the browser.

## Data sources

| Source | Covers | Notes |
| --- | --- | --- |
| BlackRock Canada / iShares US holdings CSVs | iShares funds (XEQT, XIC, ITOT, IVV…) | Daily. Product pages are discovered from the iShares screeners when not listed in `lib/sources/registry.ts`. Weights are derived from exact market values because the published weight column is rounded to 0.01%. |
| SEC EDGAR N-PORT | Any US-registered fund (VTI, VOO, SCHD, QQQ…) | Quarterly, public ~60 days after quarter end. SPY, a unit trust, files none. |
| Financial Modeling Prep (optional) | Fallback for everything else (Vanguard Canada such as VEQT, BMO, SPY) | Paid; set `FMP_API_KEY`. |
| Yahoo Finance chart endpoint | Prices and CAD/USD for positions entered as units | Unofficial; falls back to FMP when a key is set. |

Securities are matched across sources by ISIN, CUSIP, ticker + country, then a normalised name plus share class (`lib/identity.ts`). N-PORT rows rarely carry tickers, so names do most of the work: on live data, 97.5% of ITOT's weight matches VTI's filing.

BlackRock Canada files for funds of funds also publish BlackRock's own look-through. The ETF page compares ours against it: for XEQT, all of BlackRock's 500 largest names match to within 0.004 percentage points.

## Running locally

```bash
npm ci
cp .env.example .env.local        # set SEC_USER_AGENT to your name and email
npx ampx sandbox                  # deploys a personal Amplify backend and writes amplify_outputs.json
npm run dev
```

Offline modes:

- `npm run dev:sample` serves the committed excerpts in `fixtures/holdings/`: real files trimmed to each fund's 40 largest rows.
- `npm run snapshot`, then `STOCKWISE_FIXTURES=live npm run dev`, serves full live files saved to `fixtures/live/` (gitignored).

The portfolio page needs an `amplify_outputs.json` to compile; the sandbox command creates it.

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
- `amplify/`: Cognito auth and the owner-only `Portfolio` model.

## Roadmap

- **Company money flow** (`AMD FLOW`): stakes a company owns (its 13F and 13D/G filings), subsidiaries (10-K Exhibit 21), which ETFs hold it, and who owns it.
- Free institutional ownership from SEC's quarterly 13F data sets, and daily fund snapshots for "what changed".
