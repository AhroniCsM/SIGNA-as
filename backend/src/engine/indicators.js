// Pure indicator math — no deps. Inputs are arrays of OHLCV candles oldest→newest.
// Each candle: {ts, open, high, low, close, volume}

export function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function stddev(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / period;
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    out[i] = Math.sqrt(v);
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out[period] = 100 - 100 / (1 + avgG / (avgL || 1e-9));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9));
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const emaF = ema(closes, fast), emaS = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaF[i] != null && emaS[i] != null ? emaF[i] - emaS[i] : null);
  const valid = macdLine.map(v => v ?? 0);
  const signal = ema(valid, sig);
  const hist = macdLine.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null);
  return { macd: macdLine, signal, hist };
}

export function trueRange(h, l, cPrev) {
  return Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const trs = [];
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i + 1] = prev;
  }
  return out;
}

export function adx(candles, period = 14) {
  // Standard Wilder ADX
  const out = new Array(candles.length).fill(null);
  if (candles.length < period * 2) return out;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }
  const smooth = (arr) => {
    const s = new Array(arr.length).fill(null);
    let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
    s[period - 1] = sum;
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      s[i] = sum;
    }
    return s;
  };
  const trS = smooth(tr), plusS = smooth(plusDM), minusS = smooth(minusDM);
  const dx = trS.map((t, i) => {
    if (t == null) return null;
    const plusDI = 100 * plusS[i] / t;
    const minusDI = 100 * minusS[i] / t;
    const sum = plusDI + minusDI || 1e-9;
    return 100 * Math.abs(plusDI - minusDI) / sum;
  });
  let first = null;
  for (let i = 0; i < dx.length; i++) {
    if (dx[i] == null) continue;
    if (first == null) {
      const slice = dx.slice(i, i + period).filter(v => v != null);
      if (slice.length < period) break;
      first = slice.reduce((a, b) => a + b, 0) / period;
      out[i + period] = first;
      let prev = first;
      for (let j = i + period + 1; j < dx.length; j++) {
        if (dx[j] == null) continue;
        prev = (prev * (period - 1) + dx[j]) / period;
        out[j] = prev;
      }
      break;
    }
  }
  return out;
}

export function bollinger(closes, period = 20, mult = 2) {
  const m = sma(closes, period), s = stddev(closes, period);
  const upper = closes.map((_, i) => m[i] != null ? m[i] + mult * s[i] : null);
  const lower = closes.map((_, i) => m[i] != null ? m[i] - mult * s[i] : null);
  return { middle: m, upper, lower };
}

export function keltner(candles, period = 20, mult = 1.5) {
  const closes = candles.map(c => c.close);
  const mid = ema(closes, period);
  const a = atr(candles, period);
  const upper = mid.map((m, i) => m != null && a[i] != null ? m + mult * a[i] : null);
  const lower = mid.map((m, i) => m != null && a[i] != null ? m - mult * a[i] : null);
  return { middle: mid, upper, lower };
}

export function squeezeOn(candles) {
  // Classic TTM: Bollinger inside Keltner = squeeze on
  const closes = candles.map(c => c.close);
  const bb = bollinger(closes, 20, 2);
  const kc = keltner(candles, 20, 1.5);
  return candles.map((_, i) =>
    bb.upper[i] != null && kc.upper[i] != null &&
    bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i] ? 1 : 0
  );
}

export function obv(candles) {
  const out = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = out[i - 1];
    if (candles[i].close > candles[i - 1].close) out.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) out.push(prev - candles[i].volume);
    else out.push(prev);
  }
  return out;
}

export function cmf(candles, period = 20) {
  const mf = candles.map(c => {
    const range = c.high - c.low || 1e-9;
    return ((c.close - c.low) - (c.high - c.close)) / range * c.volume;
  });
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const mfSum = mf.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const vSum = candles.slice(i - period + 1, i + 1).reduce((a, c) => a + c.volume, 0) || 1e-9;
    out[i] = mfSum / vSum;
  }
  return out;
}

// Compute everything at once and return the latest bar
export function computeAll(candles) {
  if (candles.length < 200) return null;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const s150 = sma(closes, 150);
  const s200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = adx(candles, 14);
  const at = atr(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const kc = keltner(candles, 20, 1.5);
  const sq = squeezeOn(candles);
  const o = obv(candles);
  const c = cmf(candles, 20);
  const volAvg20 = sma(volumes, 20);
  const volAvg50 = sma(volumes, 50);
  const i = candles.length - 1;

  // 52-week high/low (252 trading days; fallback to available)
  const lookback52 = Math.min(252, candles.length);
  let hi52 = -Infinity, lo52 = Infinity;
  for (let k = i - lookback52 + 1; k <= i; k++) {
    if (candles[k].high > hi52) hi52 = candles[k].high;
    if (candles[k].low < lo52) lo52 = candles[k].low;
  }
  const pctFromHigh52 = hi52 > 0 ? ((closes[i] - hi52) / hi52) * 100 : null;
  const pctFromLow52 = lo52 > 0 ? ((closes[i] - lo52) / lo52) * 100 : null;

  // Consolidation range (20d) — tight range = coiled for breakout
  let hi20 = -Infinity, lo20 = Infinity;
  for (let k = i - 19; k <= i; k++) {
    if (candles[k].high > hi20) hi20 = candles[k].high;
    if (candles[k].low < lo20) lo20 = candles[k].low;
  }
  const range20Pct = hi20 > 0 ? ((hi20 - lo20) / hi20) * 100 : null;
  const breakout20 = closes[i] > hi20 * 0.995 && closes[i - 1] <= hi20 * 0.995; // broke above 20d high today

  // Higher-highs / higher-lows count over last 20 bars (pattern strength)
  let hh = 0, hl = 0;
  for (let k = i - 18; k <= i; k++) {
    if (candles[k].high > candles[k - 1].high) hh++;
    if (candles[k].low > candles[k - 1].low) hl++;
  }

  // Pullback depth — distance from EMA21 (healthy pullback entry: -2% to +2%; overextended: > +8%)
  const pullbackPct = e21[i] ? ((closes[i] - e21[i]) / e21[i]) * 100 : null;

  // ATR as % of price (volatility character; low = tighter stops possible)
  const atrPct = at[i] && closes[i] ? (at[i] / closes[i]) * 100 : null;

  // MACD cross recency — did macd line cross above signal in last 5 bars?
  let macdBullCrossBarsAgo = null;
  for (let k = i; k >= Math.max(1, i - 5); k--) {
    if (m.macd[k] > m.signal[k] && m.macd[k - 1] <= m.signal[k - 1]) {
      macdBullCrossBarsAgo = i - k;
      break;
    }
  }

  // Volume trend: 20d vs 50d avg (rising participation)
  const volTrendPct = volAvg50[i] ? ((volAvg20[i] - volAvg50[i]) / volAvg50[i]) * 100 : null;

  // 5-day momentum (% change) — short-term thrust
  const mom5Pct = closes[i - 5] ? ((closes[i] - closes[i - 5]) / closes[i - 5]) * 100 : null;

  // ── Expert-requested additions ──

  // Volume-thrust on breakout (Minervini/Livermore): only meaningful if price broke to a new 5-bar high today
  let hi5 = -Infinity; for (let k = i - 5; k < i; k++) if (candles[k].high > hi5) hi5 = candles[k].high;
  const brokeNew5High = closes[i] > hi5;
  const volThrustPct = brokeNew5High && volAvg20[i] ? ((volumes[i] - volAvg20[i]) / volAvg20[i]) * 100 : null;

  // Close-to-high proximity (O'Neil "closes in upper half" strength)
  const hL = candles[i].high - candles[i].low;
  const closeToHighPct = hL > 0 ? ((closes[i] - candles[i].low) / hL) * 100 : 50;

  // Consecutive higher closes streak (Livermore/turtle persistence)
  let streakHigher = 0;
  for (let k = i; k > 0; k--) {
    if (closes[k] > closes[k - 1]) streakHigher++;
    else break;
  }

  // ROC 10 vs ROC 50 (CANSLIM short-vs-intermediate momentum alignment)
  const roc10 = closes[i - 10] ? ((closes[i] - closes[i - 10]) / closes[i - 10]) * 100 : null;
  const roc50 = closes[i - 50] ? ((closes[i] - closes[i - 50]) / closes[i - 50]) * 100 : null;

  // Stochastic %K 14,3 and %D 3 — momentum phase complement to RSI
  const kLen = 14;
  const kArr = [];
  for (let k = kLen - 1; k < candles.length; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = k - kLen + 1; j <= k; j++) {
      if (candles[j].low < lo) lo = candles[j].low;
      if (candles[j].high > hi) hi = candles[j].high;
    }
    kArr[k] = hi - lo > 0 ? ((closes[k] - lo) / (hi - lo)) * 100 : 50;
  }
  // %D = 3-SMA of K
  let dNow = null;
  if (kArr[i] != null && kArr[i - 1] != null && kArr[i - 2] != null) {
    dNow = (kArr[i] + kArr[i - 1] + kArr[i - 2]) / 3;
  }
  const stochK = kArr[i] ?? null;
  const stochD = dNow;

  return {
    ts: candles[i].ts,
    close: closes[i],
    ema21: e21[i], ema50: e50[i], sma150: s150[i], sma200: s200[i],
    rsi: r[i],
    macd: m.macd[i], macd_signal: m.signal[i], macd_hist: m.hist[i],
    macd_hist_prev: m.hist[i - 1],
    macd_bull_cross_bars_ago: macdBullCrossBarsAgo,
    adx: a[i], atr: at[i], atr_pct: atrPct,
    bb_upper: bb.upper[i], bb_lower: bb.lower[i],
    kc_upper: kc.upper[i], kc_lower: kc.lower[i],
    squeeze_on: sq[i],
    squeeze_on_prev: sq[i - 1],
    obv: o[i], obv_prev: o[i - 5],
    cmf: c[i],
    vol_ratio: volAvg20[i] ? volumes[i] / volAvg20[i] : null,
    vol_trend_pct: volTrendPct,
    high_52w: hi52, low_52w: lo52,
    pct_from_high_52w: pctFromHigh52,
    pct_from_low_52w: pctFromLow52,
    range_20d_pct: range20Pct,
    breakout_20d: breakout20,
    higher_highs_20: hh,
    higher_lows_20: hl,
    pullback_pct: pullbackPct,
    mom_5d_pct: mom5Pct,
    vol_thrust_pct: volThrustPct,
    close_to_high_pct: closeToHighPct,
    streak_higher_closes: streakHigher,
    roc_10: roc10,
    roc_50: roc50,
    stoch_k: stochK,
    stoch_d: stochD,
  };
}
