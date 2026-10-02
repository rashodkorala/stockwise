# Stockwise

A Bloomberg-style terminal for looking *through* your ETFs to the companies you actually own.

- **X-ray a fund** (`XEQT <GO>`): every underlying security, expanding funds of funds (XEQT → ITOT, XIC, XEF, XEC → stocks), with a treemap, sector and country breakdowns, and a "held via" path for each name.
- **Overlap** (`XEQT VEQT OVLP <GO>`): weighted overlap, shared holdings with both weights, and what is unique to each fund.
- **Portfolio** (`PORT <GO>`): enter units or market values to see your total exposure to each company across every fund and stock you hold, plus a fund-overlap matrix. Saved to your account (Amplify Cognito + DynamoDB) or, signed out, to the browser.

## Data sources

| Source | Covers | Notes |
| --- | --- | --- |
| BlackRock Canada / iShares US holdings CSVs | iShares funds (XEQT, XIC, ITOT, IVV…) | Daily. Product pages are discovered from the iShares screener when not listed in `lib/sources/registry.ts`. |
| SEC EDGAR N-PORT | Any US-registered fund (VTI, VOO, SCHD…) | Quarterly, public ~60 days after quarter end. Unit trusts (SPY, QQQ) do not file N-PORT. |
| Financial Modeling Prep (optional) | Fallback for everything else (Vanguard Canada, BMO, SPY, QQQ) | Paid; set `FMP_API_KEY`. |
| Yahoo Finance chart endpoint | Prices and CAD/USD for positions entered as units | Unofficial; falls back to FMP when a key is set. |

Securities are matched across sources by ISIN, CUSIP, ticker + country, then normalised name (`lib/identity.ts`), so an N-PORT row keyed by CUSIP lines up with an iShares row keyed by ticker.

## Running locally

```bash
npm ci
cp .env.example .env.local        # set SEC_USER_AGENT to your name and email
npx ampx sandbox                  # deploys a personal Amplify backend and writes amplify_outputs.json
npm run dev
```

Offline, or before you have AWS credentials set up: `npm run dev:sample` serves bundled sample data from `fixtures/` (illustrative weights covering only the largest holdings). The portfolio page still needs an `amplify_outputs.json` to compile; the sandbox command creates it.

## Tests

```bash
npm test           # parsers, identity matching, look-through, overlap, portfolio maths
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
