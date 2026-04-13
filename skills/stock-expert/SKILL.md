---
name: stock-expert
description: Live stock market expert. Knows plausible price ranges, split history, and reliable free data sources. Use to sanity-check prices and choose data APIs.
---

# Live Stock Expert Skill

## Sanity-check price ranges (post-splits, as of 2026)
Use these to catch broken data instantly. Actual prices drift ±30%, but anything outside these ranges is almost certainly wrong.

- **AAPL**: $150–$250
- **NVDA**: $100–$250 (post 10:1 split June 2024)
- **TSLA**: $150–$400
- **MSFT**: $350–$600
- **GOOGL**: $130–$250
- **META**: $400–$800
- **AMZN**: $150–$300 (post 20:1 split June 2022)
- **AMD**: $100–$250
- **SOFI**: $7–$20
- **GME**: $10–$40

Any equity showing <$10 when expected >$100 → data source failed, synthetic fallback, or stale.

## Free market data sources (ranked by reliability, 2026)

1. **Yahoo Finance** (via `yahoo-finance2` npm, or direct `query1.finance.yahoo.com/v8/finance/chart/{sym}`) — free, 15-min delayed, rate-limited to ~2k req/hr. Needs cookie+crumb for some endpoints.
2. **Stooq** (`stooq.com/q/l/?s={sym}.us&f=sd2t2ohlcv&h&e=csv`) — free CSV, no auth, EOD data, very reliable.
3. **Finnhub** free tier — 60 req/min, real-time US, requires API key.
4. **Alpha Vantage** — 25 req/day free, requires API key.
5. **Polygon.io Starter** — $29/mo, real-time, 5 calls/min.

## Always-works direct Yahoo endpoint (no library)
```
https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1y
```
Parse `chart.result[0].timestamp[]` and `chart.result[0].indicators.quote[0].{open,high,low,close,volume}[]`.
Works without auth. Better than `yahoo-finance2` library because no cookie-crumb dance.

## Split/dividend awareness
Always use **adjusted close** for indicators (SMA/EMA), never raw close. Yahoo's `chart` endpoint returns both.

## Data-delay disclosure
Free sources are 15-min delayed at best. For trading decisions, disclose delay prominently. Never claim "real-time" on free tier.
