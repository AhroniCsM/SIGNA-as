/**
 * SIGNA Signal — Core Scoring Engine & Position Sizer
 *
 * Pure-function library. No React deps — usable server-side or client-side.
 * Every function is independently testable.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

export const WEIGHTS = { trend: 0.40, oscillators: 0.25, volume: 0.20, volatility: 0.15 };

export const GRADE_TABLE = [
  { min: 75, grade: "A", sentiment: "BULLISH",  size: "full size",  rMultiple: 3.0 },
  { min: 55, grade: "B", sentiment: "BULLISH",  size: "half size",  rMultiple: 2.0 },
  { min: 40, grade: "C", sentiment: "NEUTRAL",  size: "starter",    rMultiple: 1.5 },
  { min: 0,  grade: "D", sentiment: "BEARISH",  size: "no setup",   rMultiple: null },
];

const cap = (v, max = 100) => Math.min(Math.max(v, 0), max);

/* ═══════════════════════════════════════════════════════════════════════════
   2. SUB-SCORE CALCULATORS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trend Score (0–100)
 * @param {object} ind - indicator row { close, ema_21, ema_50, sma_200, adx_14 }
 */
export function calcTrendScore(ind) {
  let pts = 0;
  if (ind.close > ind.ema_21)   pts += 25;
  if (ind.ema_21 > ind.ema_50)  pts += 25;
  if (ind.ema_50 > ind.sma_200) pts += 25;
  if (ind.close > ind.sma_200)  pts += 15;
  if (ind.adx_14 > 25)          pts += 10;
  return cap(pts);
}

/**
 * Oscillator Score (0–100)
 * @param {object} ind  - { rsi_14, macd_line, macd_signal, macd_histogram, macd_hist_prev }
 * @param {number} trendScore - previously computed trend score (for trend-strength bonus)
 */
export function calcOscillatorScore(ind, trendScore) {
  let pts = 0;
  // RSI
  if (ind.rsi_14 > 50) pts += 30;
  else if (ind.rsi_14 >= 40) pts += 15;
  // MACD
  if (ind.macd_line > ind.macd_signal) pts += 35;
  // Histogram dynamics
  if (Math.abs(ind.macd_histogram) > Math.abs(ind.macd_hist_prev)) pts += 20;
  else pts += 5;
  // Trend bonus
  if (trendScore > 70) pts += 15;
  return cap(pts);
}

/**
 * Volume Score (0–100)
 * @param {object} ind - { volume_ratio, ics_score, obv, obv_prev, cmf_20 }
 */
export function calcVolumeScore(ind) {
  let pts = 0;
  // Volume ratio tiers
  if (ind.volume_ratio >= 1.5) pts += 35;
  else if (ind.volume_ratio >= 1.0) pts += 20;
  else if (ind.volume_ratio >= 0.5) pts += 10;
  // ICS
  if (ind.ics_score > 0) pts += 25;
  else if (ind.ics_score === 0) pts += 10;
  // OBV + CMF
  const obvRising = (ind.obv ?? 0) > (ind.obv_prev ?? 0);
  if (obvRising && ind.cmf_20 > 0) pts += 25;
  else pts += 10;
  return cap(pts);
}

/**
 * Volatility Score (0–100)
 * @param {object} ind - { ttm_squeeze_on, ttm_squeeze_fired, inside_bar }
 */
export function calcVolatilityScore(ind) {
  let pts = 0;
  if (ind.ttm_squeeze_fired) pts += 80;
  else if (ind.ttm_squeeze_on) pts += 50;
  else pts += 30;
  if (ind.inside_bar) pts += 20;
  return cap(pts);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. COMPOSITE BULLISH % + GRADE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute full signal from raw indicator data.
 * @param {object} ind - merged indicator row (all fields from the indicators table + close price)
 * @returns {{ bullishPct, grade, sentiment, positionSize, rMultiple, trend, oscillators, volume, volatility }}
 */
export function computeSignal(ind) {
  const trend       = calcTrendScore(ind);
  const oscillators = calcOscillatorScore(ind, trend);
  const volume      = calcVolumeScore(ind);
  const volatility  = calcVolatilityScore(ind);

  const bullishPct = Math.round(
    trend * WEIGHTS.trend +
    oscillators * WEIGHTS.oscillators +
    volume * WEIGHTS.volume +
    volatility * WEIGHTS.volatility
  );

  const row = GRADE_TABLE.find((r) => bullishPct >= r.min);

  return {
    bullishPct,
    grade: row.grade,
    sentiment: row.sentiment,
    positionSize: row.size,
    rMultiple: row.rMultiple,
    scores: { trend, oscillators, volume, volatility },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. TRADE PARAMETER CALCULATOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {number} entry
 * @param {number} stopLoss
 * @param {number} rMultiple - from grade table (A=3, B=2, C=1.5)
 * @returns {{ target, stopPct, targetPct, riskReward }}
 */
export function calcTradeParams(entry, stopLoss, rMultiple) {
  if (!rMultiple || entry <= 0 || stopLoss <= 0 || stopLoss >= entry) {
    return { target: null, stopPct: null, targetPct: null, riskReward: null };
  }
  const risk    = entry - stopLoss;
  const target  = entry + risk * rMultiple;
  const stopPct = ((risk / entry) * 100).toFixed(1);
  const targetPct = (((target - entry) / entry) * 100).toFixed(1);
  const riskReward = `${rMultiple.toFixed(1)}:1`;

  return { target: +target.toFixed(8), stopPct, targetPct, riskReward };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. POSITION SIZER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dynamic position sizing based on portfolio & risk.
 *
 *   Quantity = (Portfolio × RiskPct) / (Entry − StopLoss)
 *
 * @param {object} params
 * @param {number} params.portfolioBalance - total account value in $
 * @param {number} params.riskPct          - risk per trade as decimal (e.g. 0.01 = 1%)
 * @param {number} params.entry            - entry price
 * @param {number} params.stopLoss         - stop-loss price
 * @returns {{ quantity, dollarRisk, positionValue }}
 */
export function calcPositionSize({ portfolioBalance, riskPct, entry, stopLoss }) {
  if (!portfolioBalance || !entry || !stopLoss || stopLoss >= entry) {
    return { quantity: 0, dollarRisk: 0, positionValue: 0 };
  }
  const dollarRisk    = portfolioBalance * riskPct;
  const riskPerShare  = entry - stopLoss;
  const quantity      = Math.floor(dollarRisk / riskPerShare);
  const positionValue = +(quantity * entry).toFixed(2);

  return { quantity, dollarRisk: +dollarRisk.toFixed(2), positionValue };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. CHECKLIST GENERATOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Auto-generate signal checklist items from raw indicators + computed scores.
 * @param {object} ind    - indicator row
 * @param {object} scores - { trend, oscillators, volume, volatility }
 * @returns {Array<{ label: string, status: 'CONFIRMED'|'LEADING'|'ALERT'|'BEARISH' }>}
 */
export function generateChecklist(ind, scores) {
  const items = [];

  // --- Trend ---
  const fullBull = ind.close > ind.ema_21 && ind.ema_21 > ind.ema_50 && ind.ema_50 > ind.sma_200;
  if (fullBull) {
    items.push({ label: "Full bull stack:\nprice>EMA21>EMA50>SMA200", status: "CONFIRMED" });
  } else if (ind.close > ind.ema_50) {
    items.push({ label: "Price above EMA50", status: "CONFIRMED" });
  } else {
    items.push({ label: "Price below key moving averages", status: "BEARISH" });
  }

  // --- Trend strength ---
  if (scores.trend >= 65) {
    items.push({ label: `Trend score strong: ${scores.trend}/100`, status: "CONFIRMED" });
  } else if (scores.trend >= 40) {
    items.push({ label: `Trend score moderate: ${scores.trend}/100`, status: "LEADING" });
  } else {
    items.push({ label: `Trend score weak: ${scores.trend}/100`, status: "BEARISH" });
  }

  // --- MACD ---
  const macdBull = ind.macd_line > ind.macd_signal;
  const histExpanding = Math.abs(ind.macd_histogram) > Math.abs(ind.macd_hist_prev);
  if (macdBull && histExpanding) {
    items.push({ label: "MACD bullish +\nhistogram expanding", status: "CONFIRMED" });
  } else if (macdBull) {
    items.push({ label: "MACD bullish +\nhistogram contracting", status: "LEADING" });
  } else if (!macdBull && !histExpanding) {
    items.push({ label: "MACD bearish +\nhistogram contracting", status: "LEADING" });
  } else {
    items.push({ label: "MACD bearish +\nhistogram expanding", status: "BEARISH" });
  }

  // --- RSI ---
  if (ind.rsi_14 > 50) {
    items.push({ label: `RSI ${Math.round(ind.rsi_14)} — bullish zone`, status: "CONFIRMED" });
  } else if (ind.rsi_14 >= 40) {
    items.push({ label: `RSI ${Math.round(ind.rsi_14)} — neutral zone`, status: "ALERT" });
  } else {
    items.push({ label: `RSI ${Math.round(ind.rsi_14)} — bearish zone`, status: "BEARISH" });
  }

  // --- ICS ---
  if (ind.ics_score > 0) {
    items.push({ label: `ICS ${ind.ics_score} — institutional accumulation`, status: "CONFIRMED" });
  } else if (ind.ics_score === 0) {
    items.push({ label: "ICS 0 — institutional distribution", status: "BEARISH" });
  } else {
    items.push({ label: `ICS ${ind.ics_score} — institutional distribution`, status: "BEARISH" });
  }

  // --- OBV + CMF ---
  const obvRising = (ind.obv ?? 0) > (ind.obv_prev ?? 0);
  if (obvRising && ind.cmf_20 > 0) {
    items.push({ label: "OBV rising + CMF positive — volume confirms", status: "CONFIRMED" });
  }

  // --- Volume ---
  if (ind.volume_ratio < 0.5) {
    items.push({ label: `Volume thin (${ind.volume_ratio.toFixed(1)}× avg) — low conviction`, status: "ALERT" });
  }

  return items;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. EARLY WARNING GENERATOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} ind - indicator row
 * @returns {Array<{ pattern, badge, description }>}
 */
export function generateWarnings(ind) {
  const warnings = [];

  if (ind.inside_bar && ind.volume_ratio < 0.5) {
    warnings.push({
      pattern: "INSIDE BAR + LOW VOLUME",
      badge: "LEADING",
      description: "Price coiling inside prior bar range on drying volume — classic pre-breakout setup.",
    });
  }

  if (ind.volume_ratio < 0.3) {
    warnings.push({
      pattern: "VOLUME DRY-UP",
      badge: "LEADING",
      description: `Volume ${Math.round((1 - ind.volume_ratio) * 100)}% below 10-bar avg with price holding steady. Institutional absorption pattern — often precedes directional move.`,
    });
  }

  if (ind.ttm_squeeze_on) {
    warnings.push({
      pattern: "SQUEEZE LOCKED",
      badge: "LEADING",
      description: "Bollinger Bands inside Keltner Channels — energy building for a directional move.",
    });
  }

  if (ind.ttm_squeeze_fired) {
    warnings.push({
      pattern: "SQUEEZE FIRED",
      badge: "CONFIRMED",
      description: "TTM Squeeze just released — momentum breakout in progress.",
    });
  }

  return warnings;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. NOTIFICATION TRIGGERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compare two consecutive signal snapshots and return triggered events.
 * @param {object} prev - previous signal { grade, bullishPct, ... }
 * @param {object} curr - current signal
 * @param {object} ind  - current indicator row
 * @returns {Array<{ type, message, severity }>}
 */
export function detectNotifications(prev, curr, ind) {
  const events = [];
  const gradeRank = { D: 0, C: 1, B: 2, A: 3 };

  // Grade upgrade
  if (prev && gradeRank[curr.grade] > gradeRank[prev.grade]) {
    events.push({
      type: "GRADE_UPGRADE",
      message: `Grade upgraded ${prev.grade} → ${curr.grade} (Bullish ${curr.bullishPct}%)`,
      severity: "high",
    });
  }

  // Grade downgrade
  if (prev && gradeRank[curr.grade] < gradeRank[prev.grade]) {
    events.push({
      type: "GRADE_DOWNGRADE",
      message: `Grade downgraded ${prev.grade} → ${curr.grade} (Bullish ${curr.bullishPct}%)`,
      severity: "medium",
    });
  }

  // TTM Squeeze fired
  if (ind.ttm_squeeze_fired) {
    events.push({
      type: "SQUEEZE_FIRED",
      message: "TTM Squeeze just fired — momentum breakout detected",
      severity: "high",
    });
  }

  // High conviction A-grade
  if (curr.grade === "A" && curr.bullishPct >= 85) {
    events.push({
      type: "HIGH_CONVICTION",
      message: `High-conviction setup: Grade A at ${curr.bullishPct}%`,
      severity: "high",
    });
  }

  return events;
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. MENTION VELOCITY (for Momentum Sidebar)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calculate mention velocity — the rate of change in social mentions over two time windows.
 * @param {number} currentMentions - mentions in the latest window (e.g. last 1h)
 * @param {number} prevMentions    - mentions in the prior window
 * @returns {{ velocity: number, label: string }}
 */
export function calcMentionVelocity(currentMentions, prevMentions) {
  if (prevMentions === 0) {
    return { velocity: currentMentions > 0 ? 999 : 0, label: currentMentions > 0 ? "NEW" : "QUIET" };
  }
  const velocity = ((currentMentions - prevMentions) / prevMentions) * 100;
  let label = "STABLE";
  if (velocity > 200) label = "VIRAL";
  else if (velocity > 100) label = "SURGING";
  else if (velocity > 50) label = "RISING";
  else if (velocity < -30) label = "FADING";
  return { velocity: Math.round(velocity), label };
}
