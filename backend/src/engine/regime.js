// Market regime engine — computes whether the broad market is in a state
// where growth-stock breakouts typically work. Applied as a grade modifier
// at API read time so signals adapt to macro without re-scanning symbols.
//
// State taxonomy (O'Neil IBD Big Picture):
//   CONFIRMED_UPTREND        — buy breakouts
//   UPTREND_UNDER_PRESSURE   — be selective, trim losers
//   DOWNTREND                — stay in cash / short
//
// Cached 30 min per process. Refreshes on demand via getMarketRegime().

import { fetchCandles } from "../sources/yahoo.js";

const CACHE_MS = 30 * 60 * 1000;
let _cache = null;            // { regime, expiresAt }
let _inflight = null;

// Sector ETFs — proxy for breadth + RS ranking
const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLE", "XLI", "XLP", "XLU", "XLB", "XLRE", "XLC"];

// ── helpers ──────────────────────────────────────────────────
function sma(arr, n) {
  if (arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function pctChange(bars, n) {
  if (bars.length < n + 1) return null;
  const last = bars[bars.length - 1].close;
  const prev = bars[bars.length - 1 - n].close;
  return ((last - prev) / prev) * 100;
}

// Count distribution days in last 25 sessions:
// index closes down ≥ 0.2% on higher volume than prior day.
function countDistributionDays(bars, lookback = 25) {
  if (bars.length < lookback + 1) return 0;
  let count = 0;
  for (let i = bars.length - lookback; i < bars.length; i++) {
    const cur = bars[i], prev = bars[i - 1];
    if (!prev) continue;
    const pct = ((cur.close - prev.close) / prev.close) * 100;
    if (pct <= -0.2 && cur.volume > prev.volume) count++;
  }
  return count;
}

// Is price above its own SMA? (returns { above, slopeUp, pctFromSma })
function trendCheck(bars, period) {
  if (bars.length < period + 5) return null;
  const closes = bars.map(b => b.close);
  const smaNow = sma(closes, period);
  const smaPrev = sma(closes.slice(0, -5), period);
  if (smaNow == null || smaPrev == null) return null;
  const last = closes[closes.length - 1];
  return {
    above: last > smaNow,
    slopeUp: smaNow > smaPrev,
    pctFromSma: ((last - smaNow) / smaNow) * 100,
    smaNow,
  };
}

// ── main computation ─────────────────────────────────────────
async function computeRegime() {
  // Fetch all required ETFs in parallel. Each is a single Massive call,
  // throttled to 13s spacing — so total ~180s worst case for 14 symbols.
  // Acceptable: cached 30 min.
  const symbols = ["SPY", "QQQ", "VIX", ...SECTOR_ETFS];
  const fetches = await Promise.allSettled(
    symbols.map(s => fetchCandles(s, "1D", { caller: "regime" }))
  );

  const bars = {};
  symbols.forEach((s, i) => {
    if (fetches[i].status === "fulfilled" && fetches[i].value?.length >= 50) {
      bars[s] = fetches[i].value;
    }
  });

  // Must have at least SPY to produce a regime.
  if (!bars.SPY) {
    return {
      state: "UNKNOWN",
      score: 50,
      reasons: ["Could not fetch SPY — regime unavailable"],
      components: {},
      ts: Math.floor(Date.now() / 1000),
      partial: true,
    };
  }

  const spy = bars.SPY;
  const qqq = bars.QQQ;
  const reasons = [];
  let score = 50; // neutral start

  // 1. SPY vs 200-SMA + slope (heaviest weight)
  const spyTrend = trendCheck(spy, 200);
  if (spyTrend) {
    if (spyTrend.above && spyTrend.slopeUp) { score += 20; reasons.push("SPY above rising 200-day SMA"); }
    else if (spyTrend.above) { score += 8; reasons.push("SPY above flat 200-day SMA"); }
    else if (spyTrend.slopeUp) { score -= 5; reasons.push("SPY below 200-SMA (slope up)"); }
    else { score -= 20; reasons.push("SPY below falling 200-day SMA — bear territory"); }
  }

  // 2. SPY vs 50-SMA (short-term health)
  const spy50 = trendCheck(spy, 50);
  if (spy50) {
    if (spy50.above && spy50.slopeUp) { score += 8; reasons.push("SPY above rising 50-SMA"); }
    else if (!spy50.above) { score -= 8; reasons.push("SPY below 50-SMA"); }
  }

  // 3. QQQ confirmation (growth leadership)
  if (qqq) {
    const qqqTrend = trendCheck(qqq, 200);
    if (qqqTrend?.above && qqqTrend?.slopeUp) { score += 8; reasons.push("QQQ confirms (growth leadership intact)"); }
    else if (qqqTrend && !qqqTrend.above) { score -= 8; reasons.push("QQQ below 200-SMA (growth under stress)"); }
  }

  // 4. Distribution days (institutional selling)
  const distDays = countDistributionDays(spy, 25);
  if (distDays >= 6) { score -= 15; reasons.push(`${distDays} distribution days in last 25 — heavy institutional selling`); }
  else if (distDays >= 4) { score -= 8; reasons.push(`${distDays} distribution days — caution`); }
  else if (distDays <= 2) { score += 5; reasons.push(`Only ${distDays} distribution days — healthy`); }

  // 5. Sector breadth — % of sector ETFs above their 50-SMA
  const sectorsWithData = SECTOR_ETFS.filter(s => bars[s]);
  let above50 = 0;
  sectorsWithData.forEach(s => {
    const t = trendCheck(bars[s], 50);
    if (t?.above) above50++;
  });
  const breadthPct = sectorsWithData.length ? Math.round((above50 / sectorsWithData.length) * 100) : null;
  if (breadthPct != null) {
    if (breadthPct >= 70) { score += 10; reasons.push(`Strong breadth: ${breadthPct}% of sectors above 50-SMA`); }
    else if (breadthPct >= 50) { score += 3; reasons.push(`OK breadth: ${breadthPct}% sectors above 50-SMA`); }
    else if (breadthPct < 30) { score -= 12; reasons.push(`Weak breadth: only ${breadthPct}% sectors above 50-SMA`); }
    else { score -= 5; reasons.push(`Mixed breadth: ${breadthPct}% sectors above 50-SMA`); }
  }

  // 6. VIX stress level
  if (bars.VIX) {
    const vixLast = bars.VIX[bars.VIX.length - 1].close;
    if (vixLast >= 30) { score -= 10; reasons.push(`VIX ${vixLast.toFixed(1)} — elevated fear`); }
    else if (vixLast >= 22) { score -= 4; reasons.push(`VIX ${vixLast.toFixed(1)} — caution`); }
    else if (vixLast < 15) { score += 4; reasons.push(`VIX ${vixLast.toFixed(1)} — calm`); }
  }

  // 7. Short-term momentum: SPY 20-day return
  const spy20 = pctChange(spy, 20);
  if (spy20 != null) {
    if (spy20 >= 3) { score += 4; reasons.push(`SPY +${spy20.toFixed(1)}% over 20 days`); }
    else if (spy20 <= -5) { score -= 8; reasons.push(`SPY ${spy20.toFixed(1)}% over 20 days — drawdown`); }
  }

  score = Math.max(0, Math.min(100, score));

  // Classify
  let state;
  if (score >= 65) state = "CONFIRMED_UPTREND";
  else if (score >= 40) state = "UPTREND_UNDER_PRESSURE";
  else state = "DOWNTREND";

  // Sector RS ranking (20-day return vs SPY)
  const sectorRS = [];
  if (spy20 != null) {
    sectorsWithData.forEach(s => {
      const r = pctChange(bars[s], 20);
      if (r != null) sectorRS.push({ etf: s, ret20: +r.toFixed(2), rs: +(r - spy20).toFixed(2) });
    });
    sectorRS.sort((a, b) => b.rs - a.rs);
  }

  return {
    state,
    score,
    reasons,
    components: {
      spyAbove200: spyTrend?.above ?? null,
      spy200SlopeUp: spyTrend?.slopeUp ?? null,
      spy50SlopeUp: spy50?.slopeUp ?? null,
      qqqAbove200: qqq ? trendCheck(qqq, 200)?.above ?? null : null,
      distributionDays: distDays,
      breadthPct,
      vix: bars.VIX ? +bars.VIX[bars.VIX.length - 1].close.toFixed(2) : null,
      spy20dReturnPct: spy20 != null ? +spy20.toFixed(2) : null,
      sectorRS: sectorRS.slice(0, 11),
      sectorsFetched: sectorsWithData.length,
    },
    ts: Math.floor(Date.now() / 1000),
    partial: sectorsWithData.length < SECTOR_ETFS.length / 2,
  };
}

// ── public cached API ────────────────────────────────────────
// Non-blocking: if nothing cached yet, kicks off a background fetch and
// returns null. Callers should treat null as "regime unknown, apply no
// modifier." Once the background fetch completes (~3 min first time),
// subsequent calls return instantly from cache.
export function getMarketRegime({ force = false, wait = false } = {}) {
  const now = Date.now();
  if (!force && _cache && _cache.expiresAt > now) return Promise.resolve(_cache.regime);
  if (!_inflight) {
    _inflight = (async () => {
      try {
        const regime = await computeRegime();
        // Short TTL (3 min) for partial/unknown results so we retry sooner.
        const ttl = (regime.state === "UNKNOWN" || regime.partial) ? 3 * 60 * 1000 : CACHE_MS;
        _cache = { regime, expiresAt: Date.now() + ttl };
        return regime;
      } catch (e) {
        console.error("[regime] compute failed:", e.message);
        return null;
      } finally {
        _inflight = null;
      }
    })();
  }
  // Return cached (possibly expired) data immediately if we have any;
  // otherwise return null so callers don't block.
  if (!force && _cache) return Promise.resolve(_cache.regime);
  if (wait) return _inflight;
  return Promise.resolve(null);
}

// Apply regime as a grade modifier. Raw grade from DB remains in `rawGrade`.
// Demotion rules:
//   CONFIRMED_UPTREND      → no change
//   UPTREND_UNDER_PRESSURE → demote 1 grade (A→B, B→C, etc.)
//   DOWNTREND              → demote 2 grades, cap at max-grade C
const GRADES = ["A", "B", "C", "D", "F"];

// ── Verdict layer ────────────────────────────────────────────────
// Single, explicit recommendation derived from the already-computed signal
// fields. This is deterministic — no new math, just a decision table.
//
//   BUY       — grade A, RR>=2, regime not DOWNTREND
//   BUY_SMALL — grade B, RR>=1.5, regime not DOWNTREND (or grade A under pressure)
//   WATCH     — grade C with RR>=2, or grade B with weak RR
//   WAIT      — no_setup=true (ADX<15) — trend too weak to fade or trade
//   AVOID     — grade D/F, or DOWNTREND regime with grade<A
//
// NOTE: volume (vol_ratio) is intentionally EXCLUDED from this decision.
// Our free-tier data sources (Massive/TwelveData/Stooq) return unreliable
// volume on partial/recent sessions — zero-volume bars, pre-settle counts,
// no-volume for ETFs, etc. Until we have a time-of-day-weighted ratio from
// a reliable source, volume stays out of the verdict.
function verdictFor(sig, regime) {
  const grade = sig.rawGrade || sig.grade;   // use pre-regime grade for base logic
  const rr = typeof sig.riskReward === "number" ? sig.riskReward
           : parseFloat(sig.riskReward) || 0;
  const regState = regime?.state || "UNKNOWN";
  const downtrend = regState === "DOWNTREND";
  const underPressure = regState === "UPTREND_UNDER_PRESSURE";

  const reasons = [];
  let verdict = "WATCH";

  if (sig.noSetup) {
    verdict = "WAIT";
    reasons.push("No setup — trend too weak (ADX low)");
  } else if (grade === "D" || grade === "F") {
    verdict = "AVOID";
    reasons.push(`Grade ${grade} — signal fails threshold`);
  } else if (downtrend && grade !== "A") {
    verdict = "AVOID";
    reasons.push("Macro regime: DOWNTREND");
  } else if (grade === "A" && rr >= 2 && !downtrend) {
    verdict = underPressure ? "BUY_SMALL" : "BUY";
    reasons.push(`Grade A · R:R ${rr.toFixed(1)}`);
    if (underPressure) reasons.push("Regime under pressure — half size");
  } else if (grade === "B" && rr >= 1.5 && !downtrend) {
    verdict = "BUY_SMALL";
    reasons.push(`Grade B · R:R ${rr.toFixed(1)}`);
    if (underPressure) reasons.push("Regime under pressure");
  } else if (grade === "C" && rr >= 2 && !downtrend) {
    verdict = "WATCH";
    reasons.push("Grade C — wait for upgrade or better setup");
  } else {
    verdict = "WATCH";
    if (rr < 1.5) reasons.push(`R:R ${rr.toFixed(1)} below threshold`);
    if (!reasons.length) reasons.push("Mixed signals");
  }

  return { verdict, verdictReasons: reasons };
}

export function applyRegimeToSignal(signal, regime) {
  if (!signal) return signal;
  if (!regime || regime.state === "UNKNOWN") {
    return { ...signal, ...verdictFor(signal, regime) };
  }
  const demotion = regime.state === "DOWNTREND" ? 2
                 : regime.state === "UPTREND_UNDER_PRESSURE" ? 1
                 : 0;
  let out;
  if (demotion === 0) {
    out = { ...signal, rawGrade: signal.grade, regime: regime.state, regimeScore: regime.score, regimeDemotion: 0 };
  } else {
    const rawIdx = GRADES.indexOf(signal.grade);
    const newIdx = Math.min(GRADES.length - 1, (rawIdx < 0 ? 0 : rawIdx) + demotion);
    const adjScore = Math.max(0, signal.score - demotion * 10);
    out = {
      ...signal,
      rawGrade: signal.grade,
      grade: GRADES[newIdx],
      score: adjScore,
      bullishPct: adjScore,
      regime: regime.state,
      regimeScore: regime.score,
      regimeDemotion: demotion,
    };
  }
  return { ...out, ...verdictFor(out, regime) };
}
