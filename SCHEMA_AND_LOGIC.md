# SIGNA Signal — Database Schema & Scoring Logic

## 1. Database Schema

### `tickers`
| Column         | Type         | Description                                |
|----------------|--------------|--------------------------------------------|
| id             | UUID / PK    | Unique ticker identifier                   |
| symbol         | VARCHAR(10)  | Ticker symbol (e.g. JRNL, BTC)             |
| name           | VARCHAR(120) | Full asset name                            |
| asset_type     | ENUM         | `stock`, `crypto`, `etf`                   |
| created_at     | TIMESTAMP    | Row creation time                          |
| updated_at     | TIMESTAMP    | Last update time                           |

### `price_snapshots`
Stores OHLCV candles used for indicator calculations.

| Column         | Type         | Description                                |
|----------------|--------------|--------------------------------------------|
| id             | BIGSERIAL/PK | Auto-increment ID                          |
| ticker_id      | UUID / FK    | → tickers.id                               |
| timeframe      | ENUM         | `1d`, `4h`, `1h`                           |
| open           | DECIMAL(18,8)| Open price                                 |
| high           | DECIMAL(18,8)| High price                                 |
| low            | DECIMAL(18,8)| Low price                                  |
| close          | DECIMAL(18,8)| Close price                                |
| volume         | BIGINT       | Period volume                              |
| timestamp      | TIMESTAMP    | Candle open time                           |

**Index:** `(ticker_id, timeframe, timestamp DESC)` — fast lookups for rolling calculations.

### `indicators`
Pre-computed technical indicator values, updated per candle close.

| Column              | Type          | Description                                     |
|---------------------|---------------|-------------------------------------------------|
| id                  | BIGSERIAL/PK  | Auto-increment ID                               |
| ticker_id           | UUID / FK     | → tickers.id                                    |
| timeframe           | ENUM          | `1d`, `4h`, `1h`                                |
| timestamp           | TIMESTAMP     | Candle time this reading belongs to              |
| ema_21              | DECIMAL(18,8) | 21-period EMA                                   |
| ema_50              | DECIMAL(18,8) | 50-period EMA                                   |
| sma_200             | DECIMAL(18,8) | 200-period SMA                                  |
| rsi_14              | DECIMAL(5,2)  | 14-period RSI (0–100)                           |
| macd_line           | DECIMAL(18,8) | MACD line (12,26)                               |
| macd_signal         | DECIMAL(18,8) | MACD signal line (9)                             |
| macd_histogram      | DECIMAL(18,8) | MACD histogram value                            |
| macd_hist_prev      | DECIMAL(18,8) | Previous bar histogram (for expansion check)    |
| volume_avg_20       | BIGINT        | 20-period average volume                        |
| volume_ratio        | DECIMAL(5,2)  | current_volume / volume_avg_20                  |
| obv                 | BIGINT        | On-Balance Volume                               |
| cmf_20              | DECIMAL(5,4)  | 20-period Chaikin Money Flow                    |
| ttm_squeeze_on      | BOOLEAN       | True = Bollinger inside Keltner (squeeze locked) |
| ttm_squeeze_fired   | BOOLEAN       | True = squeeze just released                    |
| adx_14              | DECIMAL(5,2)  | Average Directional Index                       |
| ics_score           | DECIMAL(5,2)  | Institutional Accumulation/Distribution score   |
| inside_bar          | BOOLEAN       | Current bar fully inside prior bar range        |

**Index:** `(ticker_id, timeframe, timestamp DESC)`

### `signals`
The final computed signal output per ticker, per scan.

| Column              | Type          | Description                                       |
|---------------------|---------------|---------------------------------------------------|
| id                  | BIGSERIAL/PK  | Auto-increment ID                                 |
| ticker_id           | UUID / FK     | → tickers.id                                      |
| timeframe           | ENUM          | `1d`, `4h`, `1h`                                  |
| computed_at         | TIMESTAMP     | When this signal was generated                     |
| bullish_pct         | DECIMAL(5,2)  | Overall Bullish % score (0–100)                   |
| grade               | CHAR(1)       | `A`, `B`, `C`, `D`                                |
| trend_score         | DECIMAL(5,2)  | Trend sub-score (0–100)                           |
| oscillator_score    | DECIMAL(5,2)  | Oscillator sub-score (0–100)                      |
| volume_score        | DECIMAL(5,2)  | Volume sub-score (0–100)                          |
| volatility_score    | DECIMAL(5,2)  | Volatility sub-score (0–100)                      |
| sentiment_label     | ENUM          | `BULLISH`, `NEUTRAL`, `BEARISH`                   |
| entry_price         | DECIMAL(18,8) | Suggested entry (market)                          |
| stop_loss           | DECIMAL(18,8) | Suggested stop-loss                               |
| stop_distance_pct   | DECIMAL(5,2)  | % distance from entry to stop                     |
| target_price        | DECIMAL(18,8) | Suggested target                                  |
| target_gain_pct     | DECIMAL(5,2)  | % distance from entry to target                   |
| risk_reward_ratio   | VARCHAR(10)   | e.g. "2.0:1"                                      |
| position_size_label | ENUM          | `full size`, `half size`, `starter`                |

**Index:** `(ticker_id, timeframe, computed_at DESC)`

### `signal_checklist_items`
Individual checklist rows attached to a signal.

| Column         | Type          | Description                                      |
|----------------|---------------|--------------------------------------------------|
| id             | BIGSERIAL/PK  | Auto-increment ID                                |
| signal_id      | BIGINT / FK   | → signals.id                                     |
| label          | VARCHAR(200)  | Human-readable description                       |
| status         | ENUM          | `CONFIRMED`, `LEADING`, `ALERT`, `BEARISH`       |
| sort_order     | SMALLINT      | Display order                                    |

### `early_warnings`
Special pattern detections surfaced below the checklist.

| Column         | Type          | Description                                      |
|----------------|---------------|--------------------------------------------------|
| id             | BIGSERIAL/PK  | Auto-increment ID                                |
| signal_id      | BIGINT / FK   | → signals.id                                     |
| pattern        | VARCHAR(80)   | e.g. "INSIDE BAR + LOW VOLUME", "VOLUME DRY-UP"  |
| badge          | ENUM          | `LEADING`, `ALERT`, `CONFIRMED`                  |
| description    | TEXT          | Detailed explanation text                        |

### `social_mentions`
Raw social-sentiment data used by the Momentum Scanner.

| Column         | Type          | Description                                      |
|----------------|---------------|--------------------------------------------------|
| id             | BIGSERIAL/PK  | Auto-increment ID                                |
| ticker_id      | UUID / FK     | → tickers.id                                     |
| source         | ENUM          | `twitter`, `reddit`, `stocktwits`                |
| mention_count  | INT           | Mentions in the sampling window                  |
| sentiment_avg  | DECIMAL(5,4)  | Average sentiment (−1 to +1)                     |
| sampled_at     | TIMESTAMP     | Window timestamp                                 |

---

## 2. Bullish % Scoring Logic

The **Bullish %** is a weighted composite of four sub-scores, each normalized to 0–100.

### Weights

| Sub-score    | Weight |
|--------------|--------|
| Trend        | 40 %   |
| Oscillators  | 25 %   |
| Volume       | 20 %   |
| Volatility   | 15 %   |

**Formula:**
```
bullish_pct = (trend × 0.40) + (oscillators × 0.25) + (volume × 0.20) + (volatility × 0.15)
```

---

### 2a. Trend Score (0–100)

Evaluates the "Full Bull Stack" — price relative to moving averages.

| Condition                               | Points |
|-----------------------------------------|--------|
| Price > EMA21                           | +25    |
| EMA21 > EMA50                           | +25    |
| EMA50 > SMA200                          | +25    |
| Price > SMA200                          | +15    |
| ADX > 25 (strong trend)                 | +10    |

*Cap at 100. A perfect "Full Bull Stack" with strong ADX = 100.*

**Checklist mapping:**
- All 3 MA conditions met → `"Full bull stack: price>EMA21>EMA50>SMA200"` → **CONFIRMED**
- Only price > EMA50 (but not EMA21) → **LEADING**
- None met → **BEARISH**

---

### 2b. Oscillator Score (0–100)

| Condition                                         | Points |
|---------------------------------------------------|--------|
| RSI > 50 (bullish zone)                           | +30    |
| RSI between 40–50 (neutral)                       | +15    |
| RSI < 40 (bearish)                                | +0     |
| MACD line > signal line (bullish cross)           | +35    |
| MACD histogram expanding (current > previous)     | +20    |
| MACD histogram contracting                        | +5     |
| Trend score > 70 ("Trend score strong")           | +15    |

*Cap at 100.*

**Checklist mapping:**
- RSI > 50 → `"RSI {value} — bullish zone"` → **CONFIRMED**
- MACD bullish + histogram expanding → `"MACD bullish + histogram expanding"` → **CONFIRMED**
- MACD bearish + histogram contracting → **LEADING** (potential reversal)
- Trend score ≥ 65 → `"Trend score strong: {value}/100"` → **CONFIRMED**
- Trend score < 40 → `"Trend score weak: {value}/100"` → **BEARISH**

---

### 2c. Volume Score (0–100)

| Condition                                         | Points |
|---------------------------------------------------|--------|
| Volume ratio ≥ 1.5× avg                           | +35    |
| Volume ratio 1.0–1.5× avg                         | +20    |
| Volume ratio 0.5–1.0× avg                         | +10    |
| Volume ratio < 0.5× avg (thin)                    | +0     |
| ICS > 0 (institutional accumulation)              | +25    |
| ICS = 0 (neutral)                                 | +10    |
| ICS < 0 (institutional distribution)              | +0     |
| OBV rising + CMF > 0 (positive flow)              | +25    |
| OBV flat or CMF ≤ 0                               | +10    |

*Cap at 100.*

**Checklist mapping:**
- Volume ratio < 0.5× → `"Volume thin ({ratio}× avg) — low conviction"` → **ALERT**
- ICS < 0 → `"ICS {value} — institutional distribution"` → **BEARISH**
- OBV rising + CMF > 0 → `"OBV rising + CMF positive — volume confirms"` → **CONFIRMED**

---

### 2d. Volatility Score (0–100)

| Condition                                         | Points |
|---------------------------------------------------|--------|
| TTM Squeeze locked (coiling energy)               | +50    |
| TTM Squeeze just fired (breakout)                 | +80    |
| Neither locked nor fired (normal vol)             | +30    |
| Inside bar detected                               | +20    |

*Cap at 100.*

**Early Warning triggers:**
- Squeeze locked → `"Squeeze Locked"` warning
- Inside bar + volume < 0.5× → `"INSIDE BAR + LOW VOLUME"` → **LEADING**
- Volume ratio < 0.3× → `"VOLUME DRY-UP"` → **LEADING**

---

### 3. Grade Derivation

| Bullish %   | Grade | Sentiment Label | Position Size    |
|-------------|-------|-----------------|------------------|
| 75–100      | A     | BULLISH         | full size        |
| 55–74       | B     | BULLISH         | half size        |
| 40–54       | C     | NEUTRAL         | starter          |
| 0–39        | D     | BEARISH         | no setup (avoid) |

---

### 4. Trade Parameters Auto-Calculation

```
entry_price   = current close (market)
stop_loss     = most recent swing low  OR  EMA50  (whichever is tighter)
stop_pct      = ((entry - stop) / entry) × 100
target_price  = entry + (entry - stop) × R_MULTIPLE
target_pct    = ((target - entry) / entry) × 100
risk_reward   = R_MULTIPLE : 1
```

Default `R_MULTIPLE` by grade: A → 3.0, B → 2.0, C → 1.5, D → N/A.

---

### 5. Entity-Relationship Summary

```
tickers ──< price_snapshots
tickers ──< indicators
tickers ──< signals ──< signal_checklist_items
                    ──< early_warnings
tickers ──< social_mentions
```
