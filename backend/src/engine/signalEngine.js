// Signal engine — weighted scoring: Trend 40 / Oscillators 25 / Volume 20 / Volatility 15
// Pure functions, no side effects.

export const WEIGHTS = { trend: 0.40, oscillator: 0.25, volume: 0.20, volatility: 0.15 };

export const GRADE_TABLE = [
  { min: 80, grade: "A", positionSize: "full size", sentiment: "BULLISH" },
  { min: 65, grade: "B", positionSize: "half size", sentiment: "BULLISH" },
  { min: 50, grade: "C", positionSize: "starter", sentiment: "NEUTRAL" },
  { min: 0,  grade: "D", positionSize: "no setup", sentiment: "BEARISH" },
];

export function gradeForScore(score) {
  return GRADE_TABLE.find(t => score >= t.min);
}

// Trend (40%) — bull stack, MA alignment, price>MAs
export function calcTrendScore(ind) {
  const { close, ema21, ema50, sma150, sma200, adx } = ind;
  let s = 0;
  if (close > ema21) s += 15;
  if (ema21 > ema50) s += 15;
  if (ema50 > sma200) s += 20;
  if (close > sma150) s += 15;           // MA150 filter
  if (close > sma200) s += 15;
  if (adx > 25) s += 20;
  return Math.min(100, s);
}

// Oscillators (25%) — RSI vs 50, MACD histogram expansion
export function calcOscillatorScore(ind) {
  const { rsi, macd_hist, macd_hist_prev } = ind;
  let s = 0;
  if (rsi > 70) s += 30;                 // overbought but strong
  else if (rsi > 55) s += 50;            // bullish zone
  else if (rsi > 45) s += 30;            // neutral
  else if (rsi > 30) s += 15;
  if (macd_hist > 0) s += 25;
  if (macd_hist > 0 && macd_hist_prev != null && macd_hist > macd_hist_prev) s += 25; // expanding
  return Math.min(100, s);
}

// Volume (20%) — vol ratio, OBV trend, CMF
export function calcVolumeScore(ind) {
  const { vol_ratio, obv, obv_prev, cmf } = ind;
  let s = 0;
  if (vol_ratio >= 1.5) s += 40;
  else if (vol_ratio >= 1.0) s += 25;
  else if (vol_ratio >= 0.5) s += 10;
  if (obv > obv_prev) s += 30;
  if (cmf > 0) s += 30;
  return Math.min(100, s);
}

// Volatility (15%) — squeeze status, ATR position
export function calcVolatilityScore(ind) {
  const { squeeze_on, squeeze_on_prev, close, bb_upper, bb_lower } = ind;
  let s = 0;
  if (squeeze_on_prev === 1 && squeeze_on === 0) s += 60;   // squeeze just fired → high signal
  else if (squeeze_on === 1) s += 40;                        // locked → leading indicator
  else s += 30;                                              // no squeeze
  if (close != null && bb_upper && bb_lower) {
    const pos = (close - bb_lower) / (bb_upper - bb_lower);
    if (pos > 0.5 && pos < 0.95) s += 40;                    // riding upper band, not overextended
    else if (pos >= 0.95) s += 20;
    else if (pos > 0.3) s += 25;
  }
  return Math.min(100, s);
}

export function calcTradeParams(ind) {
  const { close, atr } = ind;
  if (!close || !atr) return { entry: null, stop: null, target: null, riskReward: null };
  const entry = close;
  const stop = +(entry - atr * 1.5).toFixed(4);
  const target = +(entry + atr * 3.0).toFixed(4);
  const riskReward = +((target - entry) / (entry - stop)).toFixed(2);
  return { entry: +entry.toFixed(4), stop, target, riskReward };
}

export function generateChecklist(ind, scores) {
  const list = [];
  list.push({
    label: `Full bull stack: price${ind.close > ind.ema21 ? ">" : "<"}EMA21${ind.ema21 > ind.ema50 ? ">" : "<"}EMA50${ind.ema50 > ind.sma200 ? ">" : "<"}SMA200`,
    status: ind.close > ind.ema21 && ind.ema21 > ind.ema50 && ind.ema50 > ind.sma200 ? "CONFIRMED" : "BEARISH",
  });
  list.push({
    label: `MA150: price ${ind.close > ind.sma150 ? "above" : "below"} 150-day SMA`,
    status: ind.close > ind.sma150 ? "CONFIRMED" : "BEARISH",
  });
  list.push({
    label: `Trend score ${scores.trend >= 70 ? "strong" : scores.trend >= 40 ? "moderate" : "weak"}: ${scores.trend}/100`,
    status: scores.trend >= 70 ? "CONFIRMED" : scores.trend >= 40 ? "LEADING" : "BEARISH",
  });
  list.push({
    label: `MACD ${ind.macd_hist > 0 ? "bullish" : "bearish"} + histogram ${ind.macd_hist > ind.macd_hist_prev ? "expanding" : "contracting"}`,
    status: ind.macd_hist > 0 && ind.macd_hist > ind.macd_hist_prev ? "CONFIRMED" : ind.macd_hist > 0 ? "LEADING" : "BEARISH",
  });
  const rsiZone = ind.rsi > 55 ? "bullish" : ind.rsi > 45 ? "neutral" : "bearish";
  list.push({
    label: `RSI ${ind.rsi?.toFixed(0)} — ${rsiZone} zone`,
    status: rsiZone === "bullish" ? "CONFIRMED" : rsiZone === "neutral" ? "ALERT" : "BEARISH",
  });
  const volStatus = ind.vol_ratio >= 1.5 ? "CONFIRMED" : ind.vol_ratio >= 1.0 ? "CONFIRMED" : ind.vol_ratio >= 0.5 ? "ALERT" : "ALERT";
  list.push({
    label: `Volume ${ind.vol_ratio >= 1.0 ? "strong" : "thin"} (${ind.vol_ratio?.toFixed(1)}× avg) — ${ind.vol_ratio >= 1.0 ? "high" : "low"} conviction`,
    status: volStatus,
  });
  list.push({
    label: `OBV ${ind.obv > ind.obv_prev ? "rising" : "falling"} + CMF ${ind.cmf > 0 ? "positive" : "negative"}`,
    status: ind.obv > ind.obv_prev && ind.cmf > 0 ? "CONFIRMED" : "ALERT",
  });

  // ── High-value pro-trader confirmations ──
  // 52-week high proximity — Minervini's "within 25% of 52w high" rule
  if (ind.pct_from_high_52w != null) {
    const pct = ind.pct_from_high_52w; // negative (below high) or 0+ (at/above)
    const near = pct >= -15, mid = pct >= -25;
    list.push({
      label: `52w high: ${pct >= 0 ? "at new high" : `${Math.abs(pct).toFixed(1)}% below`}`,
      status: near ? "CONFIRMED" : mid ? "LEADING" : "BEARISH",
    });
  }

  // ADX trend strength — >25 = true trend, <20 = chop/no-trade zone
  if (ind.adx != null) {
    list.push({
      label: `ADX ${ind.adx.toFixed(0)} — ${ind.adx >= 25 ? "strong trend" : ind.adx >= 20 ? "developing trend" : "choppy / no trend"}`,
      status: ind.adx >= 25 ? "CONFIRMED" : ind.adx >= 20 ? "LEADING" : "ALERT",
    });
  }

  // Pullback depth — healthy pullback to EMA21 is an add-on entry; overextended = risky
  if (ind.pullback_pct != null) {
    const p = ind.pullback_pct;
    let label, status;
    if (p > 10) { label = `Overextended: +${p.toFixed(1)}% above EMA21`; status = "ALERT"; }
    else if (p >= -2 && p <= 5) { label = `Healthy pullback to EMA21 (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`; status = "CONFIRMED"; }
    else if (p < -2 && p >= -8) { label = `Deep pullback (${p.toFixed(1)}% below EMA21)`; status = "LEADING"; }
    else { label = `Far from EMA21 (${p.toFixed(1)}%) — poor entry`; status = "BEARISH"; }
    list.push({ label, status });
  }

  // 20-day breakout / consolidation
  if (ind.breakout_20d) {
    list.push({ label: `Breakout: new 20-day high on this bar`, status: "CONFIRMED" });
  } else if (ind.range_20d_pct != null && ind.range_20d_pct < 8) {
    list.push({ label: `Tight 20d range (${ind.range_20d_pct.toFixed(1)}%) — coiling`, status: "LEADING" });
  }

  // MACD cross recency — fresh crosses = best entry timing
  if (ind.macd_bull_cross_bars_ago != null) {
    list.push({
      label: `MACD bull cross ${ind.macd_bull_cross_bars_ago === 0 ? "today" : ind.macd_bull_cross_bars_ago + " bars ago"}`,
      status: ind.macd_bull_cross_bars_ago <= 2 ? "CONFIRMED" : "LEADING",
    });
  }

  // Higher highs / higher lows pattern (last 20 bars)
  if (ind.higher_highs_20 != null && ind.higher_lows_20 != null) {
    const hhhl = ind.higher_highs_20 + ind.higher_lows_20;
    list.push({
      label: `HH/HL pattern: ${ind.higher_highs_20} HH, ${ind.higher_lows_20} HL (20 bars)`,
      status: hhhl >= 20 ? "CONFIRMED" : hhhl >= 14 ? "LEADING" : "BEARISH",
    });
  }

  // Volume participation trend (20d vs 50d avg)
  if (ind.vol_trend_pct != null) {
    const v = ind.vol_trend_pct;
    list.push({
      label: `Participation: 20d vol ${v >= 0 ? "+" : ""}${v.toFixed(0)}% vs 50d avg`,
      status: v >= 10 ? "CONFIRMED" : v >= -10 ? "ALERT" : "BEARISH",
    });
  }

  // ATR volatility character — low ATR% enables tighter stops, higher R:R
  if (ind.atr_pct != null) {
    const a = ind.atr_pct;
    list.push({
      label: `ATR ${a.toFixed(1)}% of price — ${a < 2 ? "tight" : a < 4 ? "normal" : "volatile"}`,
      status: a < 4 ? "CONFIRMED" : "ALERT",
    });
  }

  // 5-day momentum thrust
  if (ind.mom_5d_pct != null) {
    const m5 = ind.mom_5d_pct;
    list.push({
      label: `5d momentum: ${m5 >= 0 ? "+" : ""}${m5.toFixed(1)}%`,
      status: m5 >= 3 ? "CONFIRMED" : m5 >= -3 ? "ALERT" : "BEARISH",
    });
  }

  // Volume-thrust on breakout (Minervini: low-vol breakouts fail 60%+)
  if (ind.vol_thrust_pct != null) {
    const vt = ind.vol_thrust_pct;
    list.push({
      label: `Breakout volume thrust: +${vt.toFixed(0)}% vs 20d avg`,
      status: vt >= 40 ? "CONFIRMED" : vt >= 20 ? "LEADING" : "ALERT",
    });
  }

  // Close-to-high proximity (O'Neil intraday strength)
  if (ind.close_to_high_pct != null) {
    const cth = ind.close_to_high_pct;
    list.push({
      label: `Closed in upper ${Math.round(100 - cth)}% of day's range`,
      status: cth >= 70 ? "CONFIRMED" : cth >= 50 ? "LEADING" : cth >= 30 ? "ALERT" : "BEARISH",
    });
  }

  // Consecutive higher closes streak
  if (ind.streak_higher_closes != null) {
    const s = ind.streak_higher_closes;
    list.push({
      label: `${s} consecutive higher close${s === 1 ? "" : "s"}`,
      status: s >= 3 ? "CONFIRMED" : s >= 2 ? "LEADING" : s === 1 ? "ALERT" : "BEARISH",
    });
  }

  // ROC 10 vs ROC 50 divergence (short momentum exceeding intermediate)
  if (ind.roc_10 != null && ind.roc_50 != null) {
    const r10 = ind.roc_10, r50 = ind.roc_50;
    const strengthening = r10 > r50 && r10 > 0;
    list.push({
      label: `ROC 10d (${r10 >= 0 ? "+" : ""}${r10.toFixed(1)}%) vs 50d (${r50 >= 0 ? "+" : ""}${r50.toFixed(1)}%)`,
      status: strengthening ? "CONFIRMED" : r10 > 0 ? "ALERT" : "BEARISH",
    });
  }

  // Stochastic K/D momentum phase
  if (ind.stoch_k != null && ind.stoch_d != null) {
    const k = ind.stoch_k, d = ind.stoch_d;
    let label, status;
    if (k > 80) { label = `Stoch ${k.toFixed(0)}/${d.toFixed(0)} — overbought`; status = "ALERT"; }
    else if (k > d && k > 50) { label = `Stoch ${k.toFixed(0)}/${d.toFixed(0)} — rising momentum`; status = "CONFIRMED"; }
    else if (k > d && k < 50) { label = `Stoch ${k.toFixed(0)}/${d.toFixed(0)} — bullish cross below 50`; status = "LEADING"; }
    else if (k < 20) { label = `Stoch ${k.toFixed(0)}/${d.toFixed(0)} — oversold`; status = "LEADING"; }
    else { label = `Stoch ${k.toFixed(0)}/${d.toFixed(0)} — weak momentum`; status = "BEARISH"; }
    list.push({ label, status });
  }

  return list;
}

export function generateWarnings(ind) {
  const w = [];
  if (ind.squeeze_on === 1) {
    w.push({
      pattern: "SQUEEZE LOCKED",
      badge: "LEADING",
      description: "Bollinger Bands inside Keltner Channels — energy building for a directional move. Wait for squeeze to fire before committing.",
    });
  }
  if (ind.squeeze_on_prev === 1 && ind.squeeze_on === 0) {
    w.push({
      pattern: "SQUEEZE FIRED",
      badge: "CONFIRMED",
      description: "Squeeze just released — directional move underway. High-probability entry window.",
    });
  }
  if (ind.vol_ratio < 0.5 && ind.close > ind.ema21) {
    w.push({
      pattern: "VOLUME DRY-UP",
      badge: "ALERT",
      description: `Price holding structure but volume at ${ind.vol_ratio.toFixed(1)}× avg — wait for volume confirmation before entry.`,
    });
  }
  return w;
}

export function computeSignal({ symbol, timeframe, indicator }) {
  const scores = {
    trend: calcTrendScore(indicator),
    oscillator: calcOscillatorScore(indicator),
    volume: calcVolumeScore(indicator),
    volatility: calcVolatilityScore(indicator),
  };
  const base = Math.round(
    scores.trend * WEIGHTS.trend +
    scores.oscillator * WEIGHTS.oscillator +
    scores.volume * WEIGHTS.volume +
    scores.volatility * WEIGHTS.volatility
  );

  // ── Pro-trader bonus/penalty layer (±15 max) — integrates the extended checklist into the score ──
  // Each contributor is capped; total is clamped to [-15, +15] so it's a tiebreaker, not a dominator.
  let bonus = 0;
  // 52-week high proximity (Minervini)
  if (indicator.pct_from_high_52w != null) {
    const p = indicator.pct_from_high_52w;
    if (p >= -5) bonus += 4;        // at or near 52w high
    else if (p >= -15) bonus += 2;
    else if (p < -35) bonus -= 2;
  }
  // ADX directional strength
  if (indicator.adx != null) {
    if (indicator.adx >= 25) bonus += 3;
    else if (indicator.adx < 18) bonus -= 2;
  }
  // Pullback quality
  if (indicator.pullback_pct != null) {
    const p = indicator.pullback_pct;
    if (p >= -2 && p <= 5) bonus += 2;         // healthy
    else if (p > 10) bonus -= 2;                // overextended
  }
  // Fresh breakout bonus
  if (indicator.breakout_20d) bonus += 3;
  // Volume thrust on breakout (only if broke 5-bar high)
  if (indicator.vol_thrust_pct != null) {
    if (indicator.vol_thrust_pct >= 40) bonus += 3;
    else if (indicator.vol_thrust_pct < 0) bonus -= 2;   // breakout on declining volume
  }
  // Close-to-high — conviction into the close
  if (indicator.close_to_high_pct != null) {
    if (indicator.close_to_high_pct >= 70) bonus += 2;
    else if (indicator.close_to_high_pct < 30) bonus -= 2;
  }
  // Higher-highs/lows pattern
  if (indicator.higher_highs_20 != null && indicator.higher_lows_20 != null) {
    const h = indicator.higher_highs_20 + indicator.higher_lows_20;
    if (h >= 20) bonus += 2;
    else if (h < 8) bonus -= 2;
  }
  // MACD cross recency
  if (indicator.macd_bull_cross_bars_ago != null && indicator.macd_bull_cross_bars_ago <= 2) bonus += 2;
  // ROC 10 vs 50 alignment
  if (indicator.roc_10 != null && indicator.roc_50 != null && indicator.roc_10 > indicator.roc_50 && indicator.roc_10 > 0) bonus += 2;
  // Consecutive higher closes
  if (indicator.streak_higher_closes != null && indicator.streak_higher_closes >= 3) bonus += 1;
  // Stochastic phase
  if (indicator.stoch_k != null && indicator.stoch_d != null) {
    if (indicator.stoch_k > 80) bonus -= 1;                          // overbought penalty
    else if (indicator.stoch_k > indicator.stoch_d && indicator.stoch_k > 50) bonus += 1;
  }
  // Volume participation trend
  if (indicator.vol_trend_pct != null) {
    if (indicator.vol_trend_pct >= 10) bonus += 1;
    else if (indicator.vol_trend_pct < -15) bonus -= 1;
  }
  // High ATR% = risky → small penalty
  if (indicator.atr_pct != null && indicator.atr_pct > 6) bonus -= 1;

  const bonusClamped = Math.max(-15, Math.min(15, bonus));
  const composite = Math.max(0, Math.min(100, base + bonusClamped));
  const tier = gradeForScore(composite);
  const trade = calcTradeParams(indicator);
  // noSetup = trend/structure too weak to act on. Volume intentionally excluded —
  // free-tier feeds (Massive/TwelveData/Stooq) return unreliable vol on partial or
  // recent sessions (zero-volume bars, pre-settle counts). Vetoing an A-grade signal
  // on vol_ratio 0.0× was producing false WAITs.
  const noSetup = tier.grade === "D" || (indicator.adx != null && indicator.adx < 15);

  return {
    symbol,
    timeframe,
    ts: indicator.ts,
    grade: tier.grade,
    sentiment: tier.sentiment,
    positionSize: tier.positionSize,
    score: composite,
    bullishPct: composite,
    scores,
    entry: noSetup ? null : { value: `$${trade.entry}`, sub: "market" },
    stop: noSetup ? null : { value: `$${trade.stop}`, sub: `${((1 - trade.stop / trade.entry) * 100).toFixed(1)}%` },
    target: noSetup ? null : { value: `$${trade.target}`, sub: `${((trade.target / trade.entry - 1) * 100).toFixed(1)}%` },
    riskReward: noSetup ? "N/A" : `${trade.riskReward}:1`,
    adx: indicator.adx ? Math.round(indicator.adx) : null,
    volRatio: indicator.vol_ratio ? `${indicator.vol_ratio.toFixed(1)}×` : null,
    noSetup,
    checklist: generateChecklist(indicator, scores),
    earlyWarnings: generateWarnings(indicator),
  };
}

// Grade → suggested risk-per-trade %. A conservative default profile (half-Kelly style).
// A: high-conviction, B: standard, C: probe, D/F: no trade.
export const GRADE_RISK_PCT = { A: 1.5, B: 1.0, C: 0.5, D: 0, F: 0 };
export const DEFAULT_MAX_POSITION_PCT = 20;   // cap a single position at 20% of portfolio
export const COMMISSION_PCT = 0.05;            // round-trip slippage/fee estimate (0.05% each side = 0.1% RT)

// Position sizing helper (for API/UI). Returns a rich recommendation:
//   shares, $risk, position, % of portfolio, R:R, reward @ target, expected value,
//   warnings (wide stop / poor R:R / cap hit / noSetup), and a 2-step tranche plan.
export function calcPositionSize({
  portfolio, riskPct, entry, stop, target = null, grade = null,
  maxPositionPct = DEFAULT_MAX_POSITION_PCT, noSetup = false,
}) {
  if (!portfolio || portfolio <= 0) return null;
  if (!entry || !stop || stop >= entry) return null;

  const warnings = [];
  const suggestedRiskPct = grade && GRADE_RISK_PCT[grade] != null ? GRADE_RISK_PCT[grade] : 1.0;

  if (noSetup) {
    return {
      shares: 0, dollarRisk: 0, positionValue: 0, positionPct: 0,
      reward: 0, rMultiple: 0, expectedValue: 0,
      suggestedRiskPct, riskPct,
      warnings: [{ level: "block", msg: "No setup — do not trade." }],
      tranches: [],
      commissionEst: 0,
    };
  }

  const rPerShare = entry - stop;
  const stopPctDist = (rPerShare / entry) * 100;
  if (stopPctDist > 10) warnings.push({ level: "warn", msg: `Wide stop (${stopPctDist.toFixed(1)}% from entry) — size reduced by volatility.` });

  // Base sizing from risk %
  const dollarRisk = portfolio * (riskPct / 100);
  let shares = Math.floor(dollarRisk / rPerShare);
  let positionValue = shares * entry;

  // Apply max-position cap
  const maxPositionDollars = portfolio * (maxPositionPct / 100);
  let capHit = false;
  if (positionValue > maxPositionDollars) {
    shares = Math.floor(maxPositionDollars / entry);
    positionValue = shares * entry;
    capHit = true;
    warnings.push({ level: "warn", msg: `Position capped at ${maxPositionPct}% of portfolio (${maxPositionDollars.toFixed(0)}). Full risk not used.` });
  }

  const actualDollarRisk = shares * rPerShare;
  const positionPct = portfolio > 0 ? (positionValue / portfolio) * 100 : 0;

  // Target / reward / R-multiple
  let reward = 0, rMultiple = 0;
  if (target && target > entry) {
    reward = shares * (target - entry);
    rMultiple = (target - entry) / rPerShare;
    if (rMultiple < 2) warnings.push({ level: "warn", msg: `Low R:R (${rMultiple.toFixed(2)}:1). Pros target ≥2:1.` });
  } else {
    warnings.push({ level: "info", msg: "No target price — reward projection unavailable." });
  }

  // Expected value (assumes ~50% hit rate for B-grade; better for A, worse for C)
  const winRateByGrade = { A: 0.55, B: 0.50, C: 0.40, D: 0.30, F: 0.25 };
  const wr = winRateByGrade[grade] ?? 0.45;
  const expectedValue = target ? wr * reward - (1 - wr) * actualDollarRisk : null;

  // Fees/slippage estimate (round trip)
  const commissionEst = positionValue * (COMMISSION_PCT * 2) / 100;

  // Tranche plan: 50% starter at entry, 50% add-on above +0.5R (trend confirmation)
  const addOnPrice = entry + rPerShare * 0.5;
  const tranches = shares > 1 ? [
    { label: "Starter", shares: Math.floor(shares / 2), price: entry, note: "Enter on signal confirmation" },
    { label: "Add-on", shares: shares - Math.floor(shares / 2), price: +addOnPrice.toFixed(2), note: `Add above ${addOnPrice.toFixed(2)} (+0.5R — trend confirming)` },
  ] : [];

  return {
    shares,
    dollarRisk: +actualDollarRisk.toFixed(2),
    positionValue: +positionValue.toFixed(2),
    positionPct: +positionPct.toFixed(2),
    stopPctDist: +stopPctDist.toFixed(2),
    reward: +reward.toFixed(2),
    rMultiple: +rMultiple.toFixed(2),
    expectedValue: expectedValue != null ? +expectedValue.toFixed(2) : null,
    winRateUsed: wr,
    suggestedRiskPct,
    riskPct,
    maxPositionPct,
    capHit,
    commissionEst: +commissionEst.toFixed(2),
    warnings,
    tranches,
    // Back-compat field name (old UI)
    quantity: shares,
  };
}
