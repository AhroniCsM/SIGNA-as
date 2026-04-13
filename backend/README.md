# SIGNA — Local Backend (Phase 1)

Local-first signal engine. No cloud, no API keys required. Free data sources only.

## What it does

Three processes share one SQLite DB:

- **Market worker** — every 5 min fetches daily candles for your watchlist from Yahoo Finance, computes indicators (EMA21/50, SMA150/200, RSI, MACD, ADX, ATR, Bollinger, Keltner, TTM Squeeze, OBV, CMF, volume ratio) and a weighted composite signal (Trend 40% / Osc 25% / Vol 20% / Volatility 15%). Writes grade A/B/C/D + checklist + warnings to `signals` table.
- **Social worker** — every 2 min scans Reddit (r/wallstreetbets, r/stocks, r/investing, r/cryptocurrency) and StockTwits per-symbol streams. Extracts cashtags, tags lightweight sentiment, computes 1-hour mention velocity (current vs prior window).
- **API server** — Express on `:4000` exposing `/api/signals`, `/api/signals/:symbol`, `/api/signals/:symbol/history`, `/api/momentum`, `/api/position-size`.

Data persists in `signa.db` (SQLite). Zero setup.

## Setup (5 minutes)

```bash
cd backend
cp .env.example .env          # optional — edit WATCHLIST + intervals
npm install                    # ~20s
npm run test:engine AAPL       # sanity check: fetch + score AAPL
npm start                      # launches api + market + social workers
```

Open http://localhost:4000/api/signals — should return `[]` initially, then populate within ~30 seconds as the first market scan completes.

## Individual processes

If you prefer running them separately (clearer logs):

```bash
npm run worker:market          # market scan loop
npm run worker:social          # social scan loop
npm run api                    # API server
```

## Wiring the dashboard

The current `Dashboard_preview.html` uses a hardcoded `ALL_SIGNALS` object. To switch to live data, replace that block with:

```js
const [signals, setSignals] = useState({});
useEffect(() => {
  const load = () => fetch("http://localhost:4000/api/signals")
    .then(r => r.json())
    .then(arr => setSignals(Object.fromEntries(arr.map(s => [s.symbol, s]))));
  load();
  const id = setInterval(load, 30_000);
  return () => clearInterval(id);
}, []);
// then: Object.values(signals).map(sig => <SignalCard signal={sig} .../>)
```

## Data source cadence + limits

| Source | Cadence | Limit (free) | Notes |
|--------|---------|--------------|-------|
| Yahoo Finance | every 5m | ~soft, polite UA | 15-min delayed quotes, daily candles fine |
| Reddit JSON | every 2m | 60 req/min | no auth needed, just User-Agent |
| StockTwits | every 2m | ~200 req/hour | per-symbol streams |

Keep WATCHLIST under ~20 symbols to stay comfortably within limits.

## Directory layout

```
backend/
├── src/
│   ├── db/schema.js           SQLite schema + helpers
│   ├── engine/
│   │   ├── indicators.js      Pure math (EMA, RSI, MACD, ADX, BB, KC, TTM, OBV, CMF)
│   │   ├── signalEngine.js    Scoring weights + grade + checklist generation
│   │   └── test.js            Smoke test: fetch + score one symbol
│   ├── sources/
│   │   ├── yahoo.js           yahoo-finance2 wrapper
│   │   ├── reddit.js          Reddit JSON scanner
│   │   └── stocktwits.js      StockTwits stream
│   ├── workers/
│   │   ├── marketWorker.js    cron: fetch candles → compute → persist signal
│   │   └── socialWorker.js    cron: scrape mentions → compute velocity
│   ├── api/server.js          Express read API
│   └── index.js               All-in-one launcher
├── .env.example
└── package.json
```

## Upgrade path (when ready)

- **DB** — swap SQLite for Postgres + TimescaleDB. The schema is compatible; only `openDb()` changes.
- **Queue** — add Redis Streams between workers and engine for backpressure.
- **Real-time** — add Polygon.io websocket in `src/sources/polygon.js`, dispatch into the same pipeline.
- **Alerts** — hook `telegramBot.js` into the signal insert step to fire on grade upgrades + squeeze fires.
- **Deploy** — push `backend/` to Railway; `npm start` is the run command.
