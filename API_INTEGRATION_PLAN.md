# SIGNA — API Integration Plan

## Overview

This document maps every piece of data in the SIGNA schema to a specific, free-or-cheap API endpoint. The goal is to keep the stack cost under $50/month while maintaining ≤ 15-minute data freshness for stocks and ≤ 1-minute for crypto.

---

## 1. Market Data (OHLCV + Indicators)

### Primary: Alpha Vantage (Free tier: 25 req/day, Premium: $49.99/mo for 75 req/min)

| Schema Table       | AV Endpoint                        | Notes                                     |
|--------------------|------------------------------------|-------------------------------------------|
| `price_snapshots`  | `TIME_SERIES_DAILY`                | Daily OHLCV for stocks                    |
| `price_snapshots`  | `TIME_SERIES_INTRADAY` (interval=60min) | Intraday 1h candles                 |
| `indicators.ema_21`  | `EMA` (time_period=21)           | Server-side EMA computation               |
| `indicators.ema_50`  | `EMA` (time_period=50)           | Server-side EMA computation               |
| `indicators.sma_200` | `SMA` (time_period=200)          | Server-side SMA computation               |
| `indicators.rsi_14`  | `RSI` (time_period=14)           | Server-side RSI computation               |
| `indicators.macd_*`  | `MACD` (defaults: 12,26,9)       | Returns line, signal, histogram           |
| `indicators.adx_14`  | `ADX` (time_period=14)           | Server-side ADX computation               |

**Endpoint pattern:**
```
https://www.alphavantage.co/query?function=EMA&symbol=JRNL&interval=daily&time_period=21&series_type=close&apikey=YOUR_KEY
```

### Crypto: CoinGecko (Free: 30 req/min)

| Schema Field       | CG Endpoint                                     | Notes                             |
|--------------------|--------------------------------------------------|-----------------------------------|
| `price_snapshots`  | `/api/v3/coins/{id}/ohlc?days=30`               | Daily OHLC for last 30 days       |
| Current price      | `/api/v3/simple/price?ids=bitcoin&vs_currencies=usd` | Real-time price              |
| Volume             | `/api/v3/coins/{id}/market_chart?days=30`        | Volume history                    |

### Fallback: Yahoo Finance (yfinance Python)

```python
import yfinance as yf
ticker = yf.Ticker("JRNL")
hist = ticker.history(period="6mo", interval="1d")  # OHLCV DataFrame
```

**Use when:** Alpha Vantage rate-limited or for bulk historical backfill.

---

## 2. Volume & Flow Indicators (computed locally)

These indicators are NOT available from APIs — compute from raw OHLCV data:

| Indicator          | Computation                                                     | Library              |
|--------------------|-----------------------------------------------------------------|----------------------|
| `volume_ratio`     | `current_vol / SMA(volume, 20)`                                | Custom               |
| `obv`              | Cumulative: if close > prev_close, +vol, else -vol             | `ta-lib` or custom   |
| `cmf_20`           | `SMA(((close-low)-(high-close))/(high-low) * volume, 20) / SMA(volume, 20)` | `ta-lib`  |
| `ttm_squeeze_*`    | Bollinger(20,2) inside Keltner(20,1.5) = squeeze on            | Custom (see below)   |
| `ics_score`        | Proxy: large-block trades as % of total volume                 | Polygon.io trades    |
| `inside_bar`       | `high < prev_high AND low > prev_low`                          | Custom               |

### TTM Squeeze Implementation

```javascript
function ttmSqueeze(candles, bbPeriod = 20, bbMult = 2.0, kcPeriod = 20, kcMult = 1.5) {
  const bb = bollingerBands(candles, bbPeriod, bbMult);
  const kc = keltnerChannels(candles, kcPeriod, kcMult);
  const squeezeOn = bb.upper < kc.upper && bb.lower > kc.lower;
  const prevSqueezeOn = /* same calc for previous bar */;
  const squeezeFired = !squeezeOn && prevSqueezeOn;
  return { squeezeOn, squeezeFired };
}
```

---

## 3. Social Sentiment

### Reddit — Free JSON API

| Schema Field       | Endpoint                                               | Rate Limit     |
|--------------------|--------------------------------------------------------|----------------|
| `social_mentions`  | `https://www.reddit.com/r/wallstreetbets/new.json?limit=100` | 60 req/min |
| `social_mentions`  | `https://www.reddit.com/r/stocks/new.json?limit=100`  | 60 req/min     |

**Extraction logic:**
1. Fetch new posts every 15 minutes
2. Regex-scan titles + body for `$TICKER` or known symbol list
3. Count mentions per ticker per window
4. Basic sentiment: keyword scoring ("bullish", "calls", "moon" → +1; "puts", "crash", "dump" → −1)
5. Store aggregated count + avg sentiment in `social_mentions`

### StockTwits — Free Trending API

| Schema Field       | Endpoint                                          | Notes                   |
|--------------------|---------------------------------------------------|-------------------------|
| `social_mentions`  | `https://api.stocktwits.com/api/2/trending/symbols.json` | Top 30 trending  |
| Per-ticker         | `https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json` | Recent messages |

### Twitter/X — v2 Free Tier (limited)

| Schema Field       | Endpoint                                          | Notes                   |
|--------------------|---------------------------------------------------|-------------------------|
| `social_mentions`  | `GET /2/tweets/search/recent?query=$TICKER`       | 10k tweets/month free   |

**Smart Sentiment upgrade path:** Replace keyword scoring with a lightweight LLM call:

```javascript
// services/sentimentLLM.js
async function classifySentiment(posts) {
  const prompt = `Classify each post as HYPE (retail excitement, emojis, "to the moon"),
  INSTITUTIONAL (mentions of fund flows, SEC filings, block trades, accumulation),
  or NOISE (unrelated, spam). Return JSON array.
  Posts: ${JSON.stringify(posts.map(p => p.text).slice(0, 20))}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  return res.json();
}
```

---

## 4. Notification / Webhook Triggers

| Event              | Source                     | Delivery              |
|--------------------|----------------------------|-----------------------|
| Grade upgrade      | `detectNotifications()` in `signalEngine.js` | Webhook → Telegram |
| Squeeze fired      | `indicators.ttm_squeeze_fired` flip | Webhook → Telegram   |
| High conviction    | Grade A + bullishPct ≥ 85  | Webhook → Telegram    |
| Bull Trap          | Mention velocity ↑ + volume ↓ | Webhook → Telegram  |

**Webhook endpoint:** `POST /api/webhook/signal` (see `telegramBot.js`)

---

## 5. Data Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CRON SCHEDULER                          │
│  (Node.js setInterval or Vercel Cron or GitHub Actions)     │
└───────┬──────────────┬──────────────┬───────────────────────┘
        │              │              │
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │ Alpha    │  │ CoinGecko│  │ Reddit /     │
  │ Vantage  │  │ API      │  │ StockTwits / │
  │ (stocks) │  │ (crypto) │  │ X API        │
  └────┬─────┘  └────┬─────┘  └──────┬───────┘
       │              │               │
       ▼              ▼               ▼
  ┌────────────────────────────────────────────┐
  │           INGESTION LAYER                   │
  │  • Normalize OHLCV → price_snapshots       │
  │  • Compute indicators locally (TA-Lib)     │
  │  • Count mentions → social_mentions        │
  │  • LLM classify sentiment (Haiku)          │
  └────────────────────┬───────────────────────┘
                       │
                       ▼
  ┌────────────────────────────────────────────┐
  │           SIGNAL ENGINE                     │
  │  • computeSignal(indicators)               │
  │  • generateChecklist(indicators, scores)   │
  │  • generateWarnings(indicators)            │
  │  • calcPositionSize(portfolio, risk, ...)  │
  │  • detectNotifications(prev, curr, ind)    │
  └────────┬───────────────────┬───────────────┘
           │                   │
           ▼                   ▼
  ┌──────────────┐    ┌────────────────┐
  │  PostgreSQL  │    │  Webhook       │
  │  (signals,   │    │  Dispatcher    │
  │   checklist, │    │  → Telegram    │
  │   warnings)  │    │  → Slack       │
  └──────┬───────┘    │  → Email       │
         │            └────────────────┘
         ▼
  ┌────────────────────────────────────────────┐
  │           NEXT.JS FRONTEND                  │
  │  • Dashboard.jsx (grid + sidebar)          │
  │  • SignalCard.jsx (individual signals)     │
  │  • MomentumSidebar.jsx (social ranking)    │
  │  • SSR/ISR with 60s revalidation           │
  └────────────────────────────────────────────┘
```

---

## 6. Refresh Cadence

| Data Type        | Refresh Rate     | Source          | Cost              |
|------------------|------------------|-----------------|-------------------|
| Stock OHLCV      | Every 15 min     | Alpha Vantage   | Free (25/day)     |
| Crypto OHLCV     | Every 1 min      | CoinGecko       | Free              |
| Technical Indic. | On OHLCV refresh | Local compute   | $0                |
| Social mentions  | Every 15 min     | Reddit/ST/X     | Free              |
| LLM sentiment    | Every 15 min     | Claude Haiku    | ~$5/mo            |
| Signal compute   | On indicator refresh | Local        | $0                |
| **Total**        |                  |                 | **~$5–50/mo**     |

---

## 7. Data Latency Handling

When using free-tier APIs that provide delayed data:

```javascript
// services/dataSource.js
export function getDataSourceMeta(source) {
  const delays = {
    "alphavantage_free": 15,   // 15-min delay on free tier
    "alphavantage_premium": 0,
    "coingecko": 0,            // real-time
    "yahoo_finance": 15,       // ~15 min delay
  };
  return {
    delayMinutes: delays[source] || 0,
    isDelayed: (delays[source] || 0) > 0,
  };
}
```

The `dataDelay` field flows into `SignalCard` → triggers the red "Delayed Signal" banner.

---

## 8. Environment Variables Required

```bash
# Market Data
ALPHA_VANTAGE_API_KEY=your_key

# Sentiment
REDDIT_CLIENT_ID=your_id
REDDIT_CLIENT_SECRET=your_secret
ANTHROPIC_API_KEY=your_key         # for Haiku sentiment classification

# Notifications
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Database
DATABASE_URL=postgresql://user:pass@host:5432/signa

# App
NEXT_PUBLIC_DATA_SOURCE=alphavantage_free   # or alphavantage_premium
```
